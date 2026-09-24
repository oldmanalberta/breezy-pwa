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

// MARK: - Widget bridge
//
// The web app publishes a compact forecast snapshot every time it paints; the
// widget extension reads it from the shared App Group container. Kept in this
// file rather than its own because the Capacitor project's App target is a
// plain Xcode group — a new file would need adding to the project by hand.

import WidgetKit

enum BreezyAppGroup {
    static let id = "group.ca.oldmanalberta.breezy"
    static let forecastKey = "forecast"
}

@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "publish", returnType: CAPPluginReturnPromise),
    ]

    @objc func publish(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("json missing")
            return
        }
        guard let defaults = UserDefaults(suiteName: BreezyAppGroup.id) else {
            // App Group not configured on this build; the widget simply stays empty
            call.resolve(["stored": false])
            return
        }
        defaults.set(json, forKey: BreezyAppGroup.forecastKey)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve(["stored": true])
    }
}

/// The storyboard's root view controller. Registers the local plugin once the
/// bridge exists — Capacitor only auto-discovers plugins that ship as packages.
class BreezyViewController: CAPBridgeViewController {
    private var registered = false

    private func registerBreezyPlugins(from stage: String) {
        guard let bridge = bridge else {
            print("Breezy: \(stage) — bridge not ready yet")
            return
        }
        if registered { return }
        registered = true
        bridge.registerPluginInstance(WidgetBridgePlugin())
        print("Breezy: WidgetBridge registered from \(stage)")
    }

    override open func capacitorDidLoad() {
        registerBreezyPlugins(from: "capacitorDidLoad")
    }

    override open func viewDidLoad() {
        super.viewDidLoad()
        registerBreezyPlugins(from: "viewDidLoad")
    }
}
