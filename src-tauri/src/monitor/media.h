#ifndef FRAMECRAFT_MEDIA_H
#define FRAMECRAFT_MEDIA_H
#include <stdint.h>
#include <stddef.h>
typedef struct FcMedia FcMedia;
typedef struct { uint64_t instance, physical, device; uint32_t family; } FcDevice;
typedef struct { const char *file; double start; int image, width, height; } FcInput;
typedef struct { uint64_t image, semaphore, value; uint32_t layout, access, family, width, height; } FcFrame;
FcMedia *fc_media_create(const char *device, const char *extensions, char *error, size_t capacity);
void fc_media_destroy(FcMedia *media);
int fc_media_device(FcMedia *media, FcDevice *device);
int fc_media_scene(FcMedia *media, const char *graph, const FcInput *inputs, int count, double fps, uint32_t buffered_frames, char *error, size_t capacity);
int fc_media_frame(FcMedia *media, int frame, char *error, size_t capacity);
int fc_media_acquire(FcMedia *media, FcFrame *frame);
void fc_media_release(FcMedia *media, int submitted);
void fc_media_queue(FcMedia *media, int lock);
#endif
