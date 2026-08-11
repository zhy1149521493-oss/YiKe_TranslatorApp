// 完整链路验证:加载 8 语模型 + WASAPI loopback 捕获 5 秒 + 喂给识别器
// 定位崩溃发生在:模型加载 / WASAPI 初始化 / 数据解析 / ASR 解码
use sherpa_onnx::{LinearResampler, OnlineRecognizer, OnlineRecognizerConfig};
use std::time::{Duration, Instant};
use windows::core::GUID;
use windows::Win32::Media::Audio::{
    eConsole, eRender, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, IAudioCaptureClient,
    IAudioClient, IMMDeviceEnumerator, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

unsafe fn parse_format(pwf: *const WAVEFORMATEX) -> (u16, u32, u16, bool) {
    let wf = &*pwf;
    if wf.wFormatTag == 65534 {
        let ext = &*(pwf as *const WAVEFORMATEXTENSIBLE);
        let sub = ext.SubFormat;
        let ieee_float = GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);
        (wf.nChannels, wf.nSamplesPerSec, wf.wBitsPerSample, sub == ieee_float)
    } else {
        (wf.nChannels, wf.nSamplesPerSec, wf.wBitsPerSample, wf.wFormatTag == 3)
    }
}

fn main() {
    let dir = r"E:\TranslatorApp\asr\sherpa-onnx-streaming-zipformer-ar_en_id_ja_ru_th_vi_zh-2025-02-10";
    let (encoder, decoder, joiner, tokens) = (
        std::path::Path::new(dir).join("encoder-epoch-75-avg-11-chunk-16-left-128.int8.onnx"),
        std::path::Path::new(dir).join("decoder-epoch-75-avg-11-chunk-16-left-128.onnx"),
        std::path::Path::new(dir).join("joiner-epoch-75-avg-11-chunk-16-left-128.int8.onnx"),
        std::path::Path::new(dir).join("tokens.txt"),
    );
    let mut cfg = OnlineRecognizerConfig::default();
    cfg.model_config.transducer.encoder = Some(encoder.to_string_lossy().to_string());
    cfg.model_config.transducer.decoder = Some(decoder.to_string_lossy().to_string());
    cfg.model_config.transducer.joiner = Some(joiner.to_string_lossy().to_string());
    cfg.model_config.tokens = Some(tokens.to_string_lossy().to_string());
    cfg.model_config.num_threads = 4;
    cfg.model_config.provider = Some("cpu".to_string());
    cfg.decoding_method = Some("greedy_search".to_string());
    cfg.enable_endpoint = true;
    println!("[1] loading model...");
    let recognizer = match OnlineRecognizer::create(&cfg) {
        Some(r) => { println!("[1] model loaded OK"); r }
        None => { println!("[1] FAIL: model load"); return; }
    };

    unsafe {
        println!("[2] CoInitializeEx...");
        CoInitializeEx(None, COINIT_MULTITHREADED);
        println!("[2] CoInitializeEx done");
        println!("[3] CoCreateInstance MMDeviceEnumerator...");
        let enumerator: IMMDeviceEnumerator = match CoCreateInstance(
            &windows::Win32::Media::Audio::MMDeviceEnumerator, None, CLSCTX_ALL,
        ) {
            Ok(e) => { println!("[3] enumerator OK"); e }
            Err(e) => { println!("[3] FAIL: {e}"); return; }
        };
        println!("[4] GetDefaultAudioEndpoint...");
        let device = match enumerator.GetDefaultAudioEndpoint(eRender, eConsole) {
            Ok(d) => { println!("[4] device OK"); d }
            Err(e) => { println!("[4] FAIL: {e}"); return; }
        };
        println!("[5] Activate IAudioClient...");
        let audio_client: IAudioClient = match device.Activate(CLSCTX_ALL, None) {
            Ok(c) => { println!("[5] audio client OK"); c }
            Err(e) => { println!("[5] FAIL: {e}"); return; }
        };
        println!("[6] GetMixFormat...");
        let mix_format = match audio_client.GetMixFormat() {
            Ok(m) => { println!("[6] mix format OK"); m }
            Err(e) => { println!("[6] FAIL: {e}"); return; }
        };
        let (channels, sample_rate, bits, is_float) = parse_format(mix_format);
        println!("[6] format: {channels}ch {sample_rate}Hz {bits}bit float={is_float}");
        println!("[7] Initialize LOOPBACK...");
        if let Err(e) = audio_client.Initialize(
            AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 200_0000, 0, mix_format, None,
        ) {
            println!("[7] FAIL: {e}");
            return;
        }
        println!("[7] initialize OK");
        let capture: IAudioCaptureClient = match audio_client.GetService() {
            Ok(c) => { println!("[8] capture client OK"); c }
            Err(e) => { println!("[8] FAIL: {e}"); return; }
        };
        let resampler = match LinearResampler::create(sample_rate as i32, 16000) {
            Some(r) => { println!("[9] resampler OK"); r }
            None => { println!("[9] FAIL resampler"); return; }
        };
        println!("[10] Start capture...");
        if let Err(e) = audio_client.Start() {
            println!("[10] FAIL: {e}");
            return;
        }
        println!("[10] capture started, reading 5s...");
        let block_align = (bits / 8) as usize * channels as usize;
        let mut stream = recognizer.create_stream();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut frames_total: u64 = 0;
        while Instant::now() < deadline {
            let mut data_ptr: *mut u8 = std::ptr::null_mut();
            let mut num_frames: u32 = 0;
            let mut flags: u32 = 0;
            if capture.GetBuffer(&mut data_ptr, &mut num_frames, &mut flags, None, None).is_err() {
                std::thread::sleep(Duration::from_millis(5));
                continue;
            }
            if num_frames == 0 {
                let _ = capture.ReleaseBuffer(num_frames);
                std::thread::sleep(Duration::from_millis(5));
                continue;
            }
            let mut mono: Vec<f32> = Vec::with_capacity(num_frames as usize);
            let raw = std::slice::from_raw_parts(data_ptr, num_frames as usize * block_align);
            if is_float && bits == 32 {
                for frame in raw.chunks_exact(block_align) {
                    let mut sum = 0.0f32;
                    for ch in 0..channels as usize {
                        let off = ch * 4;
                        sum += f32::from_le_bytes([frame[off], frame[off+1], frame[off+2], frame[off+3]]);
                    }
                    mono.push(sum / channels as f32);
                }
            } else if !is_float && bits == 16 {
                for frame in raw.chunks_exact(block_align) {
                    let mut sum = 0.0f32;
                    for ch in 0..channels as usize {
                        let off = ch * 2;
                        sum += i16::from_le_bytes([frame[off], frame[off+1]]) as f32 / 32768.0;
                    }
                    mono.push(sum / channels as f32);
                }
            } else {
                println!("[11] unsupported format bits={bits} float={is_float}");
                break;
            }
            let _ = capture.ReleaseBuffer(num_frames);
            frames_total += num_frames as u64;
            let resampled = resampler.resample(&mono, false);
            if !resampled.is_empty() {
                stream.accept_waveform(16000, &resampled);
                while recognizer.is_ready(&stream) {
                    recognizer.decode(&stream);
                    if let Some(result) = recognizer.get_result(&stream) {
                        if recognizer.is_endpoint(&stream) {
                            let t = result.text.trim().to_string();
                            if !t.is_empty() { println!("[12] final: {t}"); }
                            recognizer.reset(&stream);
                        }
                    }
                }
            }
        }
        let _ = audio_client.Stop();
        println!("[13] done, frames={frames_total}");
    }
}
