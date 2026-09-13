#include "media.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <stdarg.h>
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavfilter/avfilter.h>
#include <libavfilter/buffersrc.h>
#include <libavfilter/buffersink.h>
#include <libavutil/hwcontext.h>
#include <libavutil/hwcontext_vulkan.h>
#include <libavutil/opt.h>

/* CPU demux/bitstream parsing and control only. Video decoders must negotiate
 * Vulkan frames. The filter graph is shared with export; its sink is GPU RGBA.
 * No video frame download, CPU scaler, browser encoding or video file cache. */
typedef struct {
    AVFormatContext *format; AVCodecContext *decoder; AVFilterContext *source;
    AVFrame *first; AVPacket *packet; int stream, draining, ended, image;
    int64_t first_pts;
} Source;
struct FcMedia {
    AVBufferRef *device; AVFilterGraph *graph; AVFilterContext *sink;
    Source *sources; int count, frame_index; AVFrame *frame; uint32_t family;
};
#ifdef _MSC_VER
static __declspec(thread) int shader_failed;
#else
static _Thread_local int shader_failed;
#endif
static void media_log(void *ptr, int level, const char *format, va_list args) {
    char line[4096]; va_list copy; va_copy(copy, args); vsnprintf(line, sizeof(line), format, copy); va_end(copy);
    if(strstr(line, "Failed executing hook") || strstr(line, "Failed dispatching") || strstr(line, "Failed compiling")
        || strstr(line, "Failed parsing custom shader") || strstr(line, "Shader appears to contain no headers")
        || strstr(line, "User hook tried resizing non-resizable stage")) shader_failed = 1;
    av_log_default_callback(ptr, level, format, args);
}
static int fail(char *out, size_t cap, const char *stage, int code) {
    char detail[AV_ERROR_MAX_STRING_SIZE]; av_strerror(code, detail, sizeof(detail));
    snprintf(out, cap, "%s: %s", stage, detail); return code;
}
static void clear_scene(FcMedia *m) {
    av_frame_free(&m->frame); avfilter_graph_free(&m->graph); m->sink = NULL;
    for(int i = 0; i < m->count; i++) {
        Source *s = &m->sources[i]; av_frame_free(&s->first); av_packet_free(&s->packet);
        avcodec_free_context(&s->decoder); avformat_close_input(&s->format);
    }
    av_freep(&m->sources); m->count = 0; m->frame_index = -1;
}
FcMedia *fc_media_create(const char *name, const char *extensions, char *error, size_t cap) {
    FcMedia *m = av_mallocz(sizeof(*m)); if(!m) return NULL;
    av_log_set_callback(media_log);
    AVDictionary *opts = NULL;
    av_dict_set(&opts, "instance_extensions", extensions, 0);
    av_dict_set(&opts, "device_extensions", "VK_KHR_swapchain", 0);
    av_dict_set(&opts, "disable_multiplane", "1", 0);
    int ret = av_hwdevice_ctx_create(&m->device, AV_HWDEVICE_TYPE_VULKAN, name, opts, 0);
    av_dict_free(&opts);
    if(ret < 0) {fail(error, cap, "Vulkan device", ret); fc_media_destroy(m); return NULL;}
    AVHWDeviceContext *hw = (void *)m->device->data; AVVulkanDeviceContext *vk = hw->hwctx;
    m->family = UINT32_MAX;
    for(int i = 0; i < vk->nb_qf; i++) if(vk->qf[i].flags & VK_QUEUE_GRAPHICS_BIT) {m->family = vk->qf[i].idx; break;}
    if(m->family == UINT32_MAX) {snprintf(error, cap, "Vulkan device has no graphics queue"); fc_media_destroy(m); return NULL;}
    return m;
}
void fc_media_destroy(FcMedia *m) {if(m) {clear_scene(m); av_buffer_unref(&m->device); av_free(m);}}
int fc_media_device(FcMedia *m, FcDevice *out) {
    AVHWDeviceContext *hw = (void *)m->device->data; AVVulkanDeviceContext *vk = hw->hwctx;
    *out = (FcDevice){(uint64_t)(uintptr_t)vk->inst, (uint64_t)(uintptr_t)vk->phys_dev, (uint64_t)(uintptr_t)vk->act_dev, m->family}; return 0;
}
static enum AVPixelFormat vulkan_format(AVCodecContext *ctx, const enum AVPixelFormat *formats) {
    (void)ctx; for(; *formats != AV_PIX_FMT_NONE; formats++) if(*formats == AV_PIX_FMT_VULKAN) return *formats;
    return AV_PIX_FMT_NONE; /* Never fall back to CPU video decoding. */
}
static int decode(Source *s, AVFrame *out) {
    for(;;) {
        int ret = avcodec_receive_frame(s->decoder, out);
        if(ret == 0) {
            int64_t pts = out->best_effort_timestamp;
            if(pts != AV_NOPTS_VALUE && pts < s->first_pts) {av_frame_unref(out); continue;}
            out->pts = pts; return 0;
        }
        if(ret != AVERROR(EAGAIN)) return ret;
        if(s->draining) return AVERROR_EOF;
        do {av_packet_unref(s->packet); ret = av_read_frame(s->format, s->packet);} while(ret >= 0 && s->packet->stream_index != s->stream);
        if(ret == AVERROR_EOF) {s->draining = 1; ret = avcodec_send_packet(s->decoder, NULL);}
        else if(ret >= 0) ret = avcodec_send_packet(s->decoder, s->packet);
        if(ret < 0 && ret != AVERROR(EAGAIN)) return ret;
    }
}
static int source_open(FcMedia *m, Source *s, const FcInput *input, double fps) {
    AVDictionary *opts = NULL; const AVInputFormat *format = NULL;
    s->image = input->image;
    if(input->image) {
        char size[64], rate[64]; snprintf(size, sizeof(size), "%dx%d", input->width, input->height); snprintf(rate, sizeof(rate), "%.12g", fps);
        format = av_find_input_format("rawvideo"); av_dict_set(&opts, "pixel_format", "rgba", 0); av_dict_set(&opts, "video_size", size, 0); av_dict_set(&opts, "framerate", rate, 0);
    }
    // All paths are resolved by the project media repository; block nested URL protocols.
    av_dict_set(&opts, "protocol_whitelist", "file", 0);
    int ret = avformat_open_input(&s->format, input->file, format, &opts); av_dict_free(&opts); if(ret < 0) return ret;
    // Container metadata is sufficient for imported MP4/MKV/WebM sources.
    // avformat_find_stream_info can open a software video decoder to probe;
    // do not use it on this GPU-only video path.
    const AVCodec *codec = NULL; s->stream = av_find_best_stream(s->format, AVMEDIA_TYPE_VIDEO, -1, -1, &codec, 0); if(s->stream < 0) return s->stream;
    s->decoder = avcodec_alloc_context3(codec); if(!s->decoder) return AVERROR(ENOMEM);
    if(s->format->streams[s->stream]->codecpar->width <= 0 || s->format->streams[s->stream]->codecpar->height <= 0) return AVERROR_INVALIDDATA;
    ret = avcodec_parameters_to_context(s->decoder, s->format->streams[s->stream]->codecpar); if(ret < 0) return ret;
    s->decoder->pkt_timebase = s->format->streams[s->stream]->time_base;
    s->decoder->thread_count = 2; s->decoder->extra_hw_frames = 2;
    if(!input->image) {s->decoder->hw_device_ctx = av_buffer_ref(m->device); s->decoder->get_format = vulkan_format;}
    ret = avcodec_open2(s->decoder, codec, NULL); if(ret < 0) return ret;
    AVRational time_base = s->format->streams[s->stream]->time_base;
    const int64_t origin = s->format->streams[s->stream]->start_time == AV_NOPTS_VALUE ? 0 : s->format->streams[s->stream]->start_time;
    s->first_pts = input->image ? 0 : origin + (int64_t)(input->start / av_q2d(time_base) + .5);
    if(!input->image && input->start > 0) {ret = av_seek_frame(s->format, s->stream, s->first_pts, AVSEEK_FLAG_BACKWARD); if(ret < 0) return ret; avcodec_flush_buffers(s->decoder);}
    s->first = av_frame_alloc(); s->packet = av_packet_alloc(); if(!s->first || !s->packet) return AVERROR(ENOMEM);
    ret = decode(s, s->first); if(ret < 0) return ret;
    if(!input->image && s->first->format != AV_PIX_FMT_VULKAN) return AVERROR(ENOSYS);
    return 0;
}
int fc_media_scene(FcMedia *m, const char *text, const FcInput *inputs, int count, double fps, uint32_t buffered_frames, char *error, size_t cap) {
    clear_scene(m); int ret = AVERROR(ENOMEM); AVFilterInOut *in = NULL, *out = NULL; AVFilterGraphSegment *segment = NULL;
    m->graph = avfilter_graph_alloc(); if(!m->graph) goto done;
    m->graph->nb_threads = 1;
    m->graph->max_buffered_frames = buffered_frames;
    shader_failed = 0;
    avfilter_graph_set_auto_convert(m->graph, AVFILTER_AUTO_CONVERT_NONE);
    m->sources = av_calloc(count ? count : 1, sizeof(*m->sources)); if(!m->sources) goto done; m->count = count;
    // Device ownership must be attached before filter initialization; otherwise
    // libplacebo creates another GPU context and cannot accept Vulkan frames.
    ret = avfilter_graph_segment_parse(m->graph, text, 0, &segment); if(ret < 0) goto done;
    ret = avfilter_graph_segment_create_filters(segment, 0); if(ret < 0) goto done;
    for(unsigned i = 0; i < m->graph->nb_filters; i++) m->graph->filters[i]->hw_device_ctx = av_buffer_ref(m->device);
    ret = avfilter_graph_segment_apply(segment, 0, &in, &out); if(ret < 0) goto done;
    for(int i = 0; i < count; i++) {
        Source *s = &m->sources[i]; ret = source_open(m, s, &inputs[i], fps); if(ret < 0) goto done;
        char name[32]; snprintf(name, sizeof(name), "in%d", i);
        AVFilterInOut *target = in; while(target && strcmp(target->name, name)) target = target->next;
        if(!target) {ret = AVERROR(EINVAL); goto done;}
        s->source = avfilter_graph_alloc_filter(m->graph, avfilter_get_by_name("buffer"), name);
        if(!s->source) {ret = AVERROR(ENOMEM); goto done;}
        AVBufferSrcParameters *p = av_buffersrc_parameters_alloc(); if(!p) {ret = AVERROR(ENOMEM); goto done;}
        p->format = s->first->format; p->width = s->first->width; p->height = s->first->height;
        p->time_base = s->format->streams[s->stream]->time_base; p->sample_aspect_ratio = s->first->sample_aspect_ratio.num ? s->first->sample_aspect_ratio : (AVRational){1, 1};
        p->hw_frames_ctx = s->first->hw_frames_ctx;
        ret = av_buffersrc_parameters_set(s->source, p); av_free(p); if(ret < 0) goto done;
        ret = avfilter_init_str(s->source, NULL); if(ret < 0) goto done;
        ret = avfilter_link(s->source, 0, target->filter_ctx, target->pad_idx); if(ret < 0) goto done;
    }
    if(!out || out->next || strcmp(out->name, "video")) {ret = AVERROR(EINVAL); goto done;}
    ret = avfilter_graph_create_filter(&m->sink, avfilter_get_by_name("buffersink"), "preview_sink", NULL, NULL, m->graph); if(ret < 0) goto done;
    ret = avfilter_link(out->filter_ctx, out->pad_idx, m->sink, 0); if(ret < 0) goto done;
    ret = avfilter_graph_config(m->graph, NULL); if(ret < 0) goto done;
    if(shader_failed) {ret = AVERROR_EXTERNAL; goto done;}
    m->frame = av_frame_alloc(); if(!m->frame) {ret = AVERROR(ENOMEM); goto done;}
    m->frame_index = -1;
 done:
    avfilter_graph_segment_free(&segment); avfilter_inout_free(&in); avfilter_inout_free(&out);
    if(ret < 0) {clear_scene(m); return fail(error, cap, "Native scene preparation", ret);} return 0;
}
int fc_media_frame(FcMedia *m, int target, char *error, size_t cap) {
    shader_failed = 0;
    if(!m->graph || target < m->frame_index) return fail(error, cap, "Native frame order", AVERROR(EINVAL));
    while(m->frame_index < target) {
        av_frame_unref(m->frame);
        int ret = av_buffersink_get_frame(m->sink, m->frame);
        if(shader_failed) {snprintf(error, cap, "Vulkan shader failed; preview stopped to preserve the requested effects. See the native log."); return AVERROR_EXTERNAL;}
        if(ret == AVERROR(EAGAIN)) {
            int fed = 0;
            for(int i = 0; i < m->count; i++) {
                Source *s = &m->sources[i]; if(s->ended || !av_buffersrc_get_nb_failed_requests(s->source)) continue;
                AVFrame *frame = s->first; s->first = NULL;
                if(!frame) {frame = av_frame_alloc(); if(!frame) return AVERROR(ENOMEM); ret = decode(s, frame);} else ret = 0;
                if(ret == AVERROR_EOF) {s->ended = 1; ret = av_buffersrc_add_frame_flags(s->source, NULL, 0);}
                else if(ret >= 0) ret = av_buffersrc_add_frame_flags(s->source, frame, 0);
                av_frame_free(&frame); if(ret < 0) return fail(error, cap, "Native source", ret); fed++;
            }
            if(!fed) return fail(error, cap, "Native graph stalled", AVERROR(EIO));
            continue;
        }
        if(ret < 0) return fail(error, cap, "Native frame", ret);
        if(m->frame->format != AV_PIX_FMT_VULKAN || !m->frame->hw_frames_ctx) return fail(error, cap, "GPU sink required", AVERROR(ENOSYS));
        m->frame_index++;
    }
    return 0;
}
int fc_media_acquire(FcMedia *m, FcFrame *out) {
    if(!m || !m->frame || !m->frame->hw_frames_ctx || !m->frame->data[0]) return -1;
    AVHWFramesContext *fc = (void *)m->frame->hw_frames_ctx->data;
    if(fc->sw_format != AV_PIX_FMT_RGBA) return -1;
    AVVulkanFramesContext *vk = fc->hwctx; AVVkFrame *frame = (void *)m->frame->data[0];
    vk->lock_frame(fc, frame);
    *out = (FcFrame){(uint64_t)(uintptr_t)frame->img[0], (uint64_t)(uintptr_t)frame->sem[0], frame->sem_value[0], frame->layout[0], frame->access[0], frame->queue_family[0], m->frame->width, m->frame->height};
    return 0;
}
void fc_media_release(FcMedia *m, int submitted) {
    AVHWFramesContext *fc = (void *)m->frame->hw_frames_ctx->data; AVVulkanFramesContext *vk = fc->hwctx; AVVkFrame *frame = (void *)m->frame->data[0];
    if(submitted) {frame->sem_value[0]++; frame->layout[0] = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL; frame->access[0] = VK_ACCESS_TRANSFER_READ_BIT;}
    vk->unlock_frame(fc, frame);
}
void fc_media_queue(FcMedia *m, int lock) {
    AVHWDeviceContext *hw = (void *)m->device->data; AVVulkanDeviceContext *vk = hw->hwctx;
    if(lock) vk->lock_queue(hw, m->family, 0); else vk->unlock_queue(hw, m->family, 0);
}
