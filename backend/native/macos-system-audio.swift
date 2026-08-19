import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

@available(macOS 13.0, *)
final class SystemAudioCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    private let destination: URL
    private let audioQueue = DispatchQueue(label: "com.chronicle.system-audio")
    private var audioFile: AVAudioFile?
    private var writeError: Error?

    init(destination: URL) {
        self.destination = destination
    }

    func record(duration: TimeInterval) async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: true
        )
        guard let display = content.displays.first else {
            throw NSError(
                domain: "ChronicleSystemAudio",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "no display available for system audio capture"]
            )
        }

        let filter = SCContentFilter(
            display: display,
            excludingApplications: [],
            exceptingWindows: []
        )
        let configuration = SCStreamConfiguration()
        configuration.capturesAudio = true
        configuration.excludesCurrentProcessAudio = true
        configuration.sampleRate = 48_000
        configuration.channelCount = 2
        configuration.width = 2
        configuration.height = 2
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        configuration.queueDepth = 3
        configuration.showsCursor = false

        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioQueue)
        try await stream.startCapture()
        try await Task.sleep(nanoseconds: UInt64(duration * 1_000_000_000))
        try await stream.stopCapture()

        audioQueue.sync {
            audioFile = nil
        }
        if let writeError {
            throw writeError
        }
        guard FileManager.default.fileExists(atPath: destination.path) else {
            throw NSError(
                domain: "ChronicleSystemAudio",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "system audio stream produced no samples"]
            )
        }
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard outputType == .audio, sampleBuffer.isValid, writeError == nil else {
            return
        }

        do {
            try sampleBuffer.withAudioBufferList { audioBufferList, _ in
                guard var description =
                    sampleBuffer.formatDescription?.audioStreamBasicDescription
                else {
                    return
                }
                guard
                    let format = AVAudioFormat(streamDescription: &description),
                    let buffer = AVAudioPCMBuffer(
                        pcmFormat: format,
                        bufferListNoCopy: audioBufferList.unsafePointer
                    )
                else {
                    return
                }

                if audioFile == nil {
                    audioFile = try AVAudioFile(
                        forWriting: destination,
                        settings: format.settings,
                        commonFormat: format.commonFormat,
                        interleaved: format.isInterleaved
                    )
                }
                try audioFile?.write(from: buffer)
            }
        } catch {
            writeError = error
        }
    }
}

guard CommandLine.arguments.count == 3 else {
    fail("usage: macos-system-audio <output.wav> <duration-seconds>")
}

guard let duration = Double(CommandLine.arguments[2]), duration > 0 else {
    fail("duration must be a positive number")
}

guard #available(macOS 13.0, *) else {
    fail("system audio capture requires macOS 13 or later")
}

let outputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let semaphore = DispatchSemaphore(value: 0)
var exitCode: Int32 = 0

Task {
    do {
        let capture = SystemAudioCapture(destination: outputURL)
        try await capture.record(duration: duration)
    } catch {
        FileHandle.standardError.write(
            ("system audio capture failed: \(error.localizedDescription)\n")
                .data(using: .utf8)!
        )
        exitCode = 1
    }
    semaphore.signal()
}

while semaphore.wait(timeout: .now() + 0.1) == .timedOut {
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05))
}
exit(exitCode)
