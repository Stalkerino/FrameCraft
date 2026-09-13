use std::ffi::CStr;
use ash::{vk, Entry};
use ash::vk::Handle;
use super::media::{Media, Frame};
use super::SurfaceInfo;
use raw_window_handle::{RawDisplayHandle, RawWindowHandle};

// The UI owns the native window until the presentation worker acknowledges
// shutdown. Vulkan may use its handles on that worker; GTK stays on the UI thread.
pub struct NativeHandles(pub RawDisplayHandle, pub RawWindowHandle);
unsafe impl Send for NativeHandles {}

/// Presentation-only prototype: one clear on demand, no decode, timer loop,
/// CPU pixel upload or software adapter. Video integration will use this
/// owned native surface rather than sending rendered frames through JS.
pub struct Surface {
    _entry: Entry,
    instance: ash::Instance,
    surface_api: ash::khr::surface::Instance,
    surface: vk::SurfaceKHR,
    physical: vk::PhysicalDevice,
    device: Option<ash::Device>,
    swap_api: Option<ash::khr::swapchain::Device>,
    swap: vk::SwapchainKHR,
    queue: vk::Queue,
    pool: vk::CommandPool,
    command: vk::CommandBuffer,
    acquired: vk::Semaphore,
    finished: Vec<vk::Semaphore>,
    fence: vk::Fence,
    extent: vk::Extent2D,
    name: String,
    owned_device: bool,
    family: u32,
}
fn error(e: vk::Result) -> String { format!("Vulkan presentation: {e:?}") }
impl Surface {
    pub fn new(handles: NativeHandles, size: (u32, u32), vendor: &str) -> Result<Self, String> {
        unsafe {
            let entry = Entry::load().map_err(|e| format!("Vulkan loader unavailable: {e}"))?;
            let NativeHandles(display, handle) = handles;
            let extensions = ash_window::enumerate_required_extensions(display).map_err(error)?;
            let app = vk::ApplicationInfo::default().application_name(c"Framecraft native monitor").api_version(vk::API_VERSION_1_2);
            let instance = entry.create_instance(&vk::InstanceCreateInfo::default().application_info(&app).enabled_extension_names(extensions), None).map_err(error)?;
            let surface_api = ash::khr::surface::Instance::new(&entry, &instance);
            let mut result = Self { _entry: entry, instance, surface_api, surface: vk::SurfaceKHR::null(), physical: vk::PhysicalDevice::null(),
                device: None, swap_api: None, swap: vk::SwapchainKHR::null(), queue: vk::Queue::null(), pool: vk::CommandPool::null(), command: vk::CommandBuffer::null(),
                acquired: vk::Semaphore::null(), finished: Vec::new(), fence: vk::Fence::null(), extent: vk::Extent2D::default(), name: String::new(), owned_device: true, family: 0 };
            result.surface = ash_window::create_surface(&result._entry, &result.instance, display, handle, None).map_err(error)?;
            trace("Vulkan surface created");
            let vendor_id = if vendor == "amd" { 0x1002 } else { 0x10de };
            let requested = std::env::var("FRAMECRAFT_VULKAN_DEVICE").ok();
            let mut candidates = Vec::new();
            for physical in result.instance.enumerate_physical_devices().map_err(error)? {
                let properties = result.instance.get_physical_device_properties(physical);
                let name = CStr::from_ptr(properties.device_name.as_ptr()).to_string_lossy().into_owned();
                if properties.vendor_id != vendor_id || properties.device_type == vk::PhysicalDeviceType::CPU
                    || requested.as_ref().is_some_and(|s| !name.to_lowercase().contains(&s.to_lowercase())) { continue; }
                for (index, family) in result.instance.get_physical_device_queue_family_properties(physical).iter().enumerate() {
                    if family.queue_flags.contains(vk::QueueFlags::GRAPHICS) && result.surface_api.get_physical_device_surface_support(physical, index as u32, result.surface).map_err(error)? {
                        candidates.push((properties.device_type == vk::PhysicalDeviceType::DISCRETE_GPU, physical, index as u32, name.clone())); break;
                    }
                }
            }
            candidates.sort_by_key(|c| !c.0);
            let (_, physical, family, name) = candidates.into_iter().next().ok_or("No selected AMD/NVIDIA GPU can present to this native surface. No software fallback was used.")?;
            result.physical = physical; result.name = name; result.family = family;
            trace("presentation adapter selected");
            let priorities = [1.0]; let queues = [vk::DeviceQueueCreateInfo::default().queue_family_index(family).queue_priorities(&priorities)];
            let extensions = [ash::khr::swapchain::NAME.as_ptr()];
            let device = result.instance.create_device(physical, &vk::DeviceCreateInfo::default().queue_create_infos(&queues).enabled_extension_names(&extensions), None).map_err(error)?;
            result.queue = device.get_device_queue(family, 0);
            result.swap_api = Some(ash::khr::swapchain::Device::new(&result.instance, &device)); result.device = Some(device);
            result.initialize_commands()?;
            result.resize(size)?;
            trace("swapchain ready");
            Ok(result)
        }
    }
    fn initialize_commands(&mut self) -> Result<(), String> {
        unsafe {
            let device = self.device.as_ref().unwrap();
            self.pool = device.create_command_pool(&vk::CommandPoolCreateInfo::default().queue_family_index(self.family).flags(vk::CommandPoolCreateFlags::RESET_COMMAND_BUFFER), None).map_err(error)?;
            self.command = device.allocate_command_buffers(&vk::CommandBufferAllocateInfo::default().command_pool(self.pool).level(vk::CommandBufferLevel::PRIMARY).command_buffer_count(1)).map_err(error)?[0];
            self.acquired = device.create_semaphore(&vk::SemaphoreCreateInfo::default(), None).map_err(error)?;
            self.fence = device.create_fence(&vk::FenceCreateInfo::default().flags(vk::FenceCreateFlags::SIGNALED), None).map_err(error)?;
            Ok(())
        }
    }
    pub fn for_media(handles: NativeHandles, size: (u32, u32), vendor: &str, media: &Media) -> Result<Self, String> {
        unsafe {
            let context = media.device(); let entry = Entry::load().map_err(|e| e.to_string())?;
            let instance = ash::Instance::load(entry.static_fn(), vk::Instance::from_raw(context.instance));
            let device = ash::Device::load(instance.fp_v1_0(), vk::Device::from_raw(context.device));
            let surface_api = ash::khr::surface::Instance::new(&entry, &instance);
            let swap_api = ash::khr::swapchain::Device::new(&instance, &device);
            let physical = vk::PhysicalDevice::from_raw(context.physical);
            let properties = instance.get_physical_device_properties(physical);
            if properties.vendor_id != (if vendor == "amd" {0x1002} else {0x10de}) {return Err("The native video device is not the requested GPU vendor".into());}
            let name = CStr::from_ptr(properties.device_name.as_ptr()).to_string_lossy().into_owned();
            let queue = device.get_device_queue(context.family, 0);
            let mut result = Self {_entry: entry, instance, surface_api, surface: vk::SurfaceKHR::null(), physical,
                device: Some(device), swap_api: Some(swap_api), swap: vk::SwapchainKHR::null(), queue, pool: vk::CommandPool::null(), command: vk::CommandBuffer::null(),
                acquired: vk::Semaphore::null(), finished: Vec::new(), fence: vk::Fence::null(), extent: vk::Extent2D::default(), name, owned_device: false, family: context.family};
            result.surface = ash_window::create_surface(&result._entry, &result.instance, handles.0, handles.1, None).map_err(error)?;
            if !result.surface_api.get_physical_device_surface_support(physical, context.family, result.surface).map_err(error)? {return Err("The decoding GPU cannot present to this monitor".into());}
            result.initialize_commands()?; result.resize(size)?; Ok(result)
        }
    }
    pub fn info(&self) -> SurfaceInfo { SurfaceInfo { adapter: self.name.clone(), backend: "Vulkan native surface", width: self.extent.width, height: self.extent.height, video_connected: !self.owned_device } }
    pub fn resize(&mut self, size: (u32, u32)) -> Result<(), String> {
        unsafe {
            let device = self.device.as_ref().unwrap(); let swap_api = self.swap_api.as_ref().unwrap();
            let caps = self.surface_api.get_physical_device_surface_capabilities(self.physical, self.surface).map_err(error)?;
            trace("surface capabilities read");
            if !caps.supported_usage_flags.contains(vk::ImageUsageFlags::TRANSFER_DST) { return Err("This surface cannot receive native Vulkan clears.".into()); }
            let extent = if caps.current_extent.width != u32::MAX { caps.current_extent } else { vk::Extent2D {
                width: size.0.clamp(caps.min_image_extent.width, caps.max_image_extent.width), height: size.1.clamp(caps.min_image_extent.height, caps.max_image_extent.height) } };
            if extent.width == self.extent.width && extent.height == self.extent.height && self.swap != vk::SwapchainKHR::null() { return Ok(()); }
            if extent.width == 0 || extent.height == 0 || extent.width > (if self.owned_device {640} else {8192}) || extent.height > (if self.owned_device {360} else {8192}) { return Err("Surface check is limited to 640 × 360 physical pixels.".into()); }
            device.device_wait_idle().map_err(error)?;
            let formats = self.surface_api.get_physical_device_surface_formats(self.physical, self.surface).map_err(error)?;
            let format = formats.iter().find(|f| f.format == vk::Format::B8G8R8A8_UNORM).or(formats.first()).ok_or("No Vulkan surface format")?;
            let count = caps.min_image_count.max(2).min(if caps.max_image_count == 0 { 3 } else { caps.max_image_count });
            let modes = self.surface_api.get_physical_device_surface_present_modes(self.physical, self.surface).map_err(error)?;
            let mode = if modes.contains(&vk::PresentModeKHR::MAILBOX) { vk::PresentModeKHR::MAILBOX } else { vk::PresentModeKHR::FIFO };
            let alpha = [vk::CompositeAlphaFlagsKHR::OPAQUE, vk::CompositeAlphaFlagsKHR::PRE_MULTIPLIED, vk::CompositeAlphaFlagsKHR::POST_MULTIPLIED, vk::CompositeAlphaFlagsKHR::INHERIT]
                .into_iter().find(|a| caps.supported_composite_alpha.contains(*a)).ok_or("No Vulkan surface alpha mode")?;
            let swap = swap_api.create_swapchain(&vk::SwapchainCreateInfoKHR::default().surface(self.surface).min_image_count(count)
                .image_format(format.format).image_color_space(format.color_space).image_extent(extent).image_array_layers(1)
                .image_usage(vk::ImageUsageFlags::TRANSFER_DST).image_sharing_mode(vk::SharingMode::EXCLUSIVE)
                .pre_transform(caps.current_transform).composite_alpha(alpha).present_mode(mode).clipped(true).old_swapchain(self.swap), None).map_err(error)?;
            trace("swapchain created");
            if self.swap != vk::SwapchainKHR::null() { swap_api.destroy_swapchain(self.swap, None); }
            self.swap = swap; self.extent = extent;
            for semaphore in self.finished.drain(..) { device.destroy_semaphore(semaphore, None); }
            for _ in swap_api.get_swapchain_images(swap).map_err(error)? {
                self.finished.push(device.create_semaphore(&vk::SemaphoreCreateInfo::default(), None).map_err(error)?);
            }
            Ok(())
        }
    }
    pub fn present(&mut self) -> Result<(), String> { self.present_inner(None, None, &mut false) }
    pub fn present_video(&mut self, media: &mut Media) -> Result<(), String> {
        let frame = media.acquire()?; let mut submitted = false;
        let result = self.present_inner(Some(&frame), Some(media), &mut submitted);
        media.release(submitted); result
    }
    fn present_inner(&mut self, frame: Option<&Frame>, media: Option<&Media>, submitted: &mut bool) -> Result<(), String> {
        unsafe {
            let device = self.device.as_ref().unwrap(); let api = self.swap_api.as_ref().unwrap();
            device.wait_for_fences(&[self.fence], true, 1_000_000_000).map_err(error)?;
            let (index, _) = api.acquire_next_image(self.swap, 1_000_000_000, self.acquired, vk::Fence::null()).map_err(error)?;
            trace("image acquired");
            device.reset_command_buffer(self.command, vk::CommandBufferResetFlags::empty()).map_err(error)?;
            device.begin_command_buffer(self.command, &vk::CommandBufferBeginInfo::default()).map_err(error)?;
            let image = api.get_swapchain_images(self.swap).map_err(error)?[index as usize];
            let range = vk::ImageSubresourceRange::default().aspect_mask(vk::ImageAspectFlags::COLOR).level_count(1).layer_count(1);
            let barrier = vk::ImageMemoryBarrier::default().image(image).subresource_range(range)
                .src_queue_family_index(vk::QUEUE_FAMILY_IGNORED).dst_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                .old_layout(vk::ImageLayout::UNDEFINED).new_layout(vk::ImageLayout::TRANSFER_DST_OPTIMAL).dst_access_mask(vk::AccessFlags::TRANSFER_WRITE);
            device.cmd_pipeline_barrier(self.command, vk::PipelineStageFlags::TOP_OF_PIPE, vk::PipelineStageFlags::TRANSFER, vk::DependencyFlags::empty(), &[], &[], &[barrier]);
            if let Some(frame) = frame {
                if frame.family != vk::QUEUE_FAMILY_IGNORED && frame.family != self.family { return Err("GPU frame requires an unsupported queue ownership transfer".into()); }
                let source = vk::Image::from_raw(frame.image);
                let source_barrier = vk::ImageMemoryBarrier::default().image(source).subresource_range(range)
                    .src_queue_family_index(vk::QUEUE_FAMILY_IGNORED).dst_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                    .old_layout(vk::ImageLayout::from_raw(frame.layout as i32)).new_layout(vk::ImageLayout::TRANSFER_SRC_OPTIMAL)
                    .src_access_mask(vk::AccessFlags::from_raw(frame.access)).dst_access_mask(vk::AccessFlags::TRANSFER_READ);
                device.cmd_pipeline_barrier(self.command, vk::PipelineStageFlags::ALL_COMMANDS, vk::PipelineStageFlags::TRANSFER, vk::DependencyFlags::empty(), &[], &[], &[source_barrier]);
                let layers = vk::ImageSubresourceLayers::default().aspect_mask(vk::ImageAspectFlags::COLOR).layer_count(1);
                let blit = vk::ImageBlit::default().src_subresource(layers).dst_subresource(layers)
                    .src_offsets([vk::Offset3D::default(), vk::Offset3D {x: frame.width as i32, y: frame.height as i32, z: 1}])
                    .dst_offsets([vk::Offset3D::default(), vk::Offset3D {x: self.extent.width as i32, y: self.extent.height as i32, z: 1}]);
                device.cmd_blit_image(self.command, source, vk::ImageLayout::TRANSFER_SRC_OPTIMAL, image, vk::ImageLayout::TRANSFER_DST_OPTIMAL, &[blit], vk::Filter::LINEAR);
            } else {
                device.cmd_clear_color_image(self.command, image, vk::ImageLayout::TRANSFER_DST_OPTIMAL, &vk::ClearColorValue { float32: [0.015, 0.23, 0.25, 1.0] }, &[range]);
            }
            let barrier = barrier.old_layout(vk::ImageLayout::TRANSFER_DST_OPTIMAL).new_layout(vk::ImageLayout::PRESENT_SRC_KHR)
                .src_access_mask(vk::AccessFlags::TRANSFER_WRITE).dst_access_mask(vk::AccessFlags::empty());
            device.cmd_pipeline_barrier(self.command, vk::PipelineStageFlags::TRANSFER, vk::PipelineStageFlags::BOTTOM_OF_PIPE, vk::DependencyFlags::empty(), &[], &[], &[barrier]);
            device.end_command_buffer(self.command).map_err(error)?;
            device.reset_fences(&[self.fence]).map_err(error)?;
            let mut waits = vec![self.acquired]; let mut stages = vec![vk::PipelineStageFlags::TRANSFER];
            let mut signals = vec![self.finished[index as usize]]; let commands = [self.command];
            let mut wait_values = vec![0]; let mut signal_values = vec![0];
            if let Some(frame) = frame {
                waits.push(vk::Semaphore::from_raw(frame.semaphore)); stages.push(vk::PipelineStageFlags::TRANSFER); wait_values.push(frame.value);
                signals.push(vk::Semaphore::from_raw(frame.semaphore)); signal_values.push(frame.value + 1);
            }
            let mut timeline = vk::TimelineSemaphoreSubmitInfo::default().wait_semaphore_values(&wait_values).signal_semaphore_values(&signal_values);
            let mut submit = vk::SubmitInfo::default().wait_semaphores(&waits).wait_dst_stage_mask(&stages).command_buffers(&commands).signal_semaphores(&signals);
            if frame.is_some() {submit = submit.push_next(&mut timeline);}
            if let Some(media) = media {media.queue(true);}
            let submission = device.queue_submit(self.queue, &[submit], self.fence);
            if let Some(media) = media {media.queue(false);}
            submission.map_err(error)?; *submitted = true;
            let swaps = [self.swap]; let indices = [index]; let presentation_waits = [signals[0]];
            if let Some(media) = media {media.queue(true);}
            let presentation = api.queue_present(self.queue, &vk::PresentInfoKHR::default().wait_semaphores(&presentation_waits).swapchains(&swaps).image_indices(&indices));
            if let Some(media) = media {media.queue(false);}
            presentation.map_err(error)?;
            trace("image submitted to presentation");
            // Wait only for submitted GPU work, not compositor visibility. A
            // semaphore belongs to each swap image, so reacquiring that image
            // guarantees its previous presentation wait has consumed it.
            device.wait_for_fences(&[self.fence], true, 1_000_000_000).map_err(error)?;
            trace("GPU frame finished"); Ok(())
        }
    }
}
fn trace(stage: &str) { if std::env::var("FRAMECRAFT_DESKTOP_CHECK").is_ok() { eprintln!("Desktop check: {stage}"); } }
impl Drop for Surface {
    fn drop(&mut self) { unsafe {
        if let Some(device) = &self.device {
            trace("GPU shutdown requested");
            let _ = device.device_wait_idle();
            trace("GPU queues idle");
            device.destroy_fence(self.fence, None); device.destroy_semaphore(self.acquired, None);
            for semaphore in &self.finished { device.destroy_semaphore(*semaphore, None); }
            device.destroy_command_pool(self.pool, None);
            if let Some(api) = &self.swap_api { api.destroy_swapchain(self.swap, None); }
            if self.owned_device {device.destroy_device(None);}
        }
        self.surface_api.destroy_surface(self.surface, None); if self.owned_device {self.instance.destroy_instance(None);}
    } }
}
