import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

import PencilKit

/// The app's web view, with the handwriting bridge registered.
class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(InkReaderPlugin())
    }
}

/// Hands a line of the Scratchpad's strokes to the system handwriting recogniser and returns the text it reads.
/// The recogniser runs on the device. It needs iPadOS 27.
@objc(InkReaderPlugin)
public class InkReaderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InkReaderPlugin"
    public let jsName = "InkReader"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise)
    ]

    @objc func read(_ call: CAPPluginCall) {
        guard let raw = call.getArray("strokes") as? [[NSNumber]] else {
            call.reject("No strokes were given.")
            return
        }
        let strokes = raw.map { $0.map { $0.doubleValue } }
        guard #available(iOS 27.0, *) else {
            call.reject("Reading strokes needs iPadOS 27 or later.")
            return
        }
        Task {
            let recogniser = PKStrokeRecognizer(preferredLanguages: nil)
            await recogniser.updateDrawing(InkReaderPlugin.drawing(from: strokes))
            let text = await recogniser.recognizedText() ?? ""
            call.resolve(["text": text])
        }
    }

    /// The Scratchpad keeps a stroke as x, y, pressure triples; PencilKit wants timed points with a pen.
    static func drawing(from strokes: [[Double]]) -> PKDrawing {
        let ink = PKInk(.pen, color: .black)
        var made: [PKStroke] = []
        var start = Date()
        for stroke in strokes {
            var points: [PKStrokePoint] = []
            var i = 0
            while i + 2 < stroke.count {
                let force = stroke[i + 2] > 0 ? stroke[i + 2] : 0.5
                points.append(PKStrokePoint(
                    location: CGPoint(x: stroke[i], y: stroke[i + 1]), timeOffset: Double(points.count) * 0.008,
                    size: CGSize(width: 3, height: 3), opacity: 1, force: CGFloat(force), azimuth: 0, altitude: .pi / 2))
                i += 3
            }
            guard !points.isEmpty else { continue }
            made.append(PKStroke(ink: ink, path: PKStrokePath(controlPoints: points, creationDate: start)))
            // Strokes follow one another in the order they were written.
            start = start.addingTimeInterval(Double(points.count) * 0.008 + 0.25)
        }
        return PKDrawing(strokes: made)
    }
}
