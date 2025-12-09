import Foundation
import AVFoundation
@preconcurrency import ScreenCaptureKit
import CoreMedia

@available(macOS 12.3, *)
@main
struct SystemAudioDump {
  static func main() async {
    do {
      fputs("Starting SystemAudioDump...\n", Darwin.stderr)

      // Check screen recording permission
      // Temporarily disabled for dev
      // if !CGPreflightScreenCaptureAccess() {
      //   fputs("❌ Screen recording permission required!\n", Darwin.stderr)
      //   if !CGRequestScreenCaptureAccess() {
      //     fputs("Permission denied. Exiting.\n", Darwin.stderr)
      //     exit(1)
      //   }
      // }
      fputs("✅ Permissions OK (skipped check)\n", Darwin.stderr)

      // Get display
      let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
      guard let display = content.displays.first else {
        fputs("❌ No display found. This usually means screen recording permission is denied.\n", Darwin.stderr)
        fputs("Please check System Settings > Privacy & Security > Screen Recording.\n", Darwin.stderr)
        exit(1)
      }

      let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
      let cfg = SCStreamConfiguration()

      if #available(macOS 13.0, *) {
        cfg.capturesAudio = true
        cfg.excludesCurrentProcessAudio = true
      } else {
        fputs("❌ Audio capture requires macOS 13.0+\n", Darwin.stderr)
        exit(1)
      }

      if #available(macOS 15.0, *) {
        cfg.captureMicrophone = false
      }

      let dumper = AudioDumper()
      let stream = SCStream(filter: filter, configuration: cfg, delegate: dumper)

      if #available(macOS 13.0, *) {
        try stream.addStreamOutput(dumper, type: .audio, sampleHandlerQueue: DispatchQueue(label: "audio"))
      }

      try await stream.startCapture()

      fputs("🎧 Capturing system audio. Press Ctrl+C to stop.\n", Darwin.stderr)

      signal(SIGINT) { _ in
        fputs("\n👋 Exiting...\n", Darwin.stderr)
        exit(0)
      }

      while true {
        try await Task.sleep(nanoseconds: 1_000_000_000)
      }

    } catch {
      fputs("Error: \(error)\n", Darwin.stderr)
      exit(1)
    }
  }
}

@available(macOS 12.3, *)
final class AudioDumper: NSObject, SCStreamDelegate, SCStreamOutput {
  private var converter: AVAudioConverter?
  private var outputFormat: AVAudioFormat?

  func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
    if #available(macOS 13.0, *), outputType == .audio {
      processAudio(sampleBuffer)
    }
  }

  private func processAudio(_ sampleBuffer: CMSampleBuffer) {
    do {
      try sampleBuffer.withAudioBufferList { abl, _ in
        guard let desc = sampleBuffer.formatDescription?.audioStreamBasicDescription else { return }

        if converter == nil {
          guard let srcFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: desc.mSampleRate, channels: desc.mChannelsPerFrame, interleaved: false),
                let tgtFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24000, channels: desc.mChannelsPerFrame, interleaved: true) else {
            fputs("Failed to create audio formats\n", Darwin.stderr)
            return
          }
          converter = AVAudioConverter(from: srcFormat, to: tgtFormat)
          outputFormat = tgtFormat
        }

        guard let converter = converter, let outFmt = outputFormat else { return }

        let srcFmt = converter.inputFormat
        guard let srcBuffer = AVAudioPCMBuffer(pcmFormat: srcFmt, frameCapacity: AVAudioFrameCount(sampleBuffer.numSamples)) else { return }
        srcBuffer.frameLength = srcBuffer.frameCapacity

        let channelCount = min(Int(srcFmt.channelCount), abl.count)
        for i in 0..<channelCount {
          guard let floatData = srcBuffer.floatChannelData?[i],
                let bufData = abl[i].mData else { continue }

          let copySize = min(Int(abl[i].mDataByteSize), Int(srcBuffer.frameCapacity) * MemoryLayout<Float>.size)
          memcpy(floatData, bufData, copySize)
        }

        let outputFrameCapacity = AVAudioFrameCount(Double(srcBuffer.frameLength) * outFmt.sampleRate / srcFmt.sampleRate)
        guard let outBuffer = AVAudioPCMBuffer(pcmFormat: outFmt, frameCapacity: outputFrameCapacity) else { return }

        var error: NSError?
        let result = converter.convert(to: outBuffer, error: &error) { _, status in
          status.pointee = .haveData
          return srcBuffer
        }

        guard result != .error, outBuffer.frameLength > 0, let pcm = outBuffer.int16ChannelData?[0] else {
          if let error = error {
            fputs("Convert error: \(error)\n", Darwin.stderr)
          }
          return
        }

        let byteCount = Int(outBuffer.frameLength) * Int(outFmt.streamDescription.pointee.mBytesPerFrame)
        let data = Data(bytes: pcm, count: byteCount)
        FileHandle.standardOutput.write(data)
      }
    } catch {
      fputs("Audio error: \(error)\n", Darwin.stderr)
    }
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    fputs("❌ Stream error: \(error)\n", Darwin.stderr)
  }
}

@MainActor var standardError = FileHandle.standardError
extension FileHandle: @retroactive TextOutputStream {
  public func write(_ string: String) {
    if let data = string.data(using: .utf8) {
      self.write(data)
    }
  }
}
