import WidgetKit
import SwiftUI

@main
struct BreezyWidgetBundle: WidgetBundle {
    var body: some Widget {
        ForecastWidget()
        HourlyWidget()
        LockScreenWidget()
    }
}
