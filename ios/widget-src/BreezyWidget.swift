import WidgetKit
import SwiftUI

// MARK: - timeline

struct BreezyEntry: TimelineEntry {
    let date: Date
    let forecast: Forecast?
}

/// One provider serves every widget. The app republishes on each paint and
/// asks WidgetKit to reload, so the data itself only changes then; the hourly
/// entries exist so the "next hours" strip keeps rolling forward on its own
/// between launches.
struct BreezyProvider: TimelineProvider {
    func placeholder(in context: Context) -> BreezyEntry {
        BreezyEntry(date: Date(), forecast: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (BreezyEntry) -> Void) {
        completion(BreezyEntry(date: Date(), forecast: Forecast.load() ?? .sample))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<BreezyEntry>) -> Void) {
        let forecast = Forecast.load()
        let now = Date()
        let cal = Calendar.current
        // this hour, then the top of each of the next six
        var entries = [BreezyEntry(date: now, forecast: forecast)]
        if let top = cal.dateInterval(of: .hour, for: now)?.end {
            for i in 0..<6 {
                entries.append(BreezyEntry(date: top.addingTimeInterval(Double(i) * 3600), forecast: forecast))
            }
        }
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}

/// The card surface the app draws every block on, so the widget reads as a
/// Breezy card lifted onto the Home Screen rather than a weather-app tile.
struct CardBackground: View {
    @Environment(\.colorScheme) private var scheme
    var body: some View { Theme(scheme: scheme).surface }
}

// MARK: - widgets

struct ForecastWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BreezyForecast", provider: BreezyProvider()) { entry in
            ForecastView(entry: entry)
                .containerBackground(for: .widget) { CardBackground() }
        }
        .configurationDisplayName("Forecast")
        .description("Current conditions and the days ahead.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}

struct HourlyWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BreezyHourly", provider: BreezyProvider()) { entry in
            HourlyView(entry: entry)
                .containerBackground(for: .widget) { CardBackground() }
        }
        .configurationDisplayName("Hourly")
        .description("The next hours, with the chance of precipitation.")
        .supportedFamilies([.systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}

struct LockScreenWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BreezyLock", provider: BreezyProvider()) { entry in
            LockView(entry: entry)
                .containerBackground(for: .widget) { Color.clear }
        }
        .configurationDisplayName("Conditions")
        .description("Temperature and conditions for the Lock Screen.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: - previews

#Preview("Forecast · small", as: .systemSmall) { ForecastWidget() } timeline: {
    BreezyEntry(date: .now, forecast: .sample)
}
#Preview("Forecast · medium", as: .systemMedium) { ForecastWidget() } timeline: {
    BreezyEntry(date: .now, forecast: .sample)
}
#Preview("Forecast · large", as: .systemLarge) { ForecastWidget() } timeline: {
    BreezyEntry(date: .now, forecast: .sample)
}
#Preview("Hourly · medium", as: .systemMedium) { HourlyWidget() } timeline: {
    BreezyEntry(date: .now, forecast: .sample)
}
#Preview("Lock · rectangular", as: .accessoryRectangular) { LockScreenWidget() } timeline: {
    BreezyEntry(date: .now, forecast: .sample)
}
