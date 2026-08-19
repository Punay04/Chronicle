import Foundation
import Vision
import CoreGraphics
import ImageIO

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

guard CommandLine.arguments.count > 1 else {
    fail("usage: macos-ocr <image-path>")
}

let imagePath = CommandLine.arguments[1]
let imageUrl = URL(fileURLWithPath: imagePath)

guard let source = CGImageSourceCreateWithURL(imageUrl as CFURL, nil),
      let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fail("could not load image: \(imagePath)")
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    fail("ocr failed: \(error.localizedDescription)")
}

var lines: [String] = []
var confidences: [Float] = []
for observation in request.results ?? [] {
    guard let candidate = observation.topCandidates(1).first else { continue }
    lines.append(candidate.string)
    confidences.append(candidate.confidence)
}

let text = lines.joined(separator: "\n")
let confidence = confidences.isEmpty
    ? 0.0
    : Double(confidences.reduce(0, +)) / Double(confidences.count)

let output: [String: Any] = ["text": text, "confidence": confidence]
let json = try! JSONSerialization.data(withJSONObject: output)
FileHandle.standardOutput.write(json)
