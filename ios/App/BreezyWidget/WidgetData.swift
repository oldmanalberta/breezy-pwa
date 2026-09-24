import Foundation

/// The snapshot the app publishes (see js/native.js). Temperatures arrive
/// already in the user's unit, so the widget only formats.
struct Forecast: Codable {
    struct Current: Codable {
        var temp: Int?
        var feels: Int?
        var condition: String
        var night: Bool
        var text: String
        var hi: Int?
        var lo: Int?
    }
    struct Hour: Codable {
        var t: Date?
        var temp: Int?
        var condition: String
        var night: Bool
        var pop: Int?
    }
    struct Day: Codable {
        var d: Date?
        var label: String?
        var hi: Int?
        var lo: Int?
        var condition: String
        var pop: Int?
    }

    var v: Int
    var updated: Date
    var place: String
    var unit: String
    var tz: String?
    var current: Current
    var hourly: [Hour]
    var daily: [Day]
    var alert: String?

    static let appGroup = "group.ca.oldmanalberta.breezy"
    static let key = "forecast"

    /// Whatever the app last published, or nil before its first run.
    static func load() -> Forecast? {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let json = defaults.string(forKey: key),
              let data = json.data(using: .utf8) else { return nil }
        return try? decoder.decode(Forecast.self, from: data)
    }

    /// JavaScript's toISOString() carries milliseconds, which the stock
    /// .iso8601 strategy rejects; accept both forms.
    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        let frac = ISO8601DateFormatter()
        frac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        d.dateDecodingStrategy = .custom { dec in
            let s = try dec.singleValueContainer().decode(String.self)
            if let v = frac.date(from: s) ?? plain.date(from: s) { return v }
            throw DecodingError.dataCorrupted(.init(codingPath: dec.codingPath, debugDescription: "bad date \(s)"))
        }
        return d
    }()

    var timeZone: TimeZone { tz.flatMap(TimeZone.init(identifier:)) ?? .current }

    /// Hours from roughly now onward, so the strip rolls forward between
    /// app launches as the timeline entries advance.
    func hours(from date: Date, count: Int) -> [Hour] {
        let cutoff = date.addingTimeInterval(-30 * 60)
        return Array(hourly.filter { ($0.t ?? .distantPast) >= cutoff }.prefix(count))
    }

    /// Placeholder content for the widget gallery and for before the app has
    /// ever published anything.
    static var sample: Forecast {
        let now = Date()
        let cal = Calendar.current
        let hours = (0..<24).map { i -> Hour in
            let t = cal.date(byAdding: .hour, value: i, to: now)!
            let conds = ["partly", "partly", "cloudy", "rainshower", "rain", "cloudy", "clear", "clear"]
            return Hour(t: t, temp: 18 - (i / 3), condition: conds[i % conds.count], night: i > 10, pop: i == 3 ? 40 : nil)
        }
        let days = (0..<7).map { i -> Day in
            let d = cal.date(byAdding: .day, value: i, to: now)!
            let conds = ["partly", "rainshower", "cloudy", "clear", "clear", "thunderrain", "partly"]
            return Day(d: d, label: i == 0 ? "Today" : nil, hi: 22 - i, lo: 9 - i, condition: conds[i], pop: i == 1 ? 60 : nil)
        }
        return Forecast(v: 1, updated: now, place: "Calgary", unit: "°C", tz: nil,
                        current: Current(temp: 19, feels: 18, condition: "partly", night: false,
                                         text: "Partly cloudy", hi: 22, lo: 9),
                        hourly: hours, daily: days, alert: nil)
    }
}

// MARK: - formatting

enum Fmt {
    static func deg(_ v: Int?) -> String { v.map { "\($0)°" } ?? "--" }

    static func hour(_ d: Date?, tz: TimeZone) -> String {
        guard let d else { return "" }
        let f = DateFormatter()
        f.timeZone = tz
        f.setLocalizedDateFormatFromTemplate("j")   // "5 PM" / "17" per locale
        return f.string(from: d).replacingOccurrences(of: " ", with: "")
    }

    static func monthDay(_ d: Date?, tz: TimeZone) -> String {
        guard let d else { return "" }
        let f = DateFormatter()
        f.timeZone = tz
        f.setLocalizedDateFormatFromTemplate("MMM d")
        return f.string(from: d)
    }

    static func weekday(_ d: Date?, tz: TimeZone) -> String {
        guard let d else { return "" }
        let f = DateFormatter()
        f.timeZone = tz
        f.dateFormat = "EEE"
        return f.string(from: d)
    }

    static func time(_ d: Date, tz: TimeZone) -> String {
        let f = DateFormatter()
        f.timeZone = tz
        f.timeStyle = .short
        f.dateStyle = .none
        return f.string(from: d)
    }
}

// MARK: - condition → SF Symbol

enum WeatherSymbol {
    /// Apple's own weather glyphs, chosen to match the app's icon set.
    static func name(_ key: String, night: Bool) -> String {
        switch key {
        case "clear":        return night ? "moon.stars.fill" : "sun.max.fill"
        case "mainlyclear":  return night ? "cloud.moon.fill" : "sun.min.fill"
        case "partly":       return night ? "cloud.moon.fill" : "cloud.sun.fill"
        case "cloudy":       return "cloud.fill"
        case "overcast":     return "cloud.fill"
        case "fog":          return "cloud.fog.fill"
        case "haze":         return night ? "moon.haze.fill" : "sun.haze.fill"
        case "drizzle":      return "cloud.drizzle.fill"
        case "rain":         return "cloud.rain.fill"
        case "heavyrain":    return "cloud.heavyrain.fill"
        case "rainshower":   return night ? "cloud.moon.rain.fill" : "cloud.sun.rain.fill"
        case "freezing":     return "cloud.sleet.fill"
        case "sleet":        return "cloud.sleet.fill"
        case "snow":         return "cloud.snow.fill"
        case "heavysnow":    return "cloud.snow.fill"
        case "snowshower":   return "cloud.snow.fill"
        case "thunder":      return "cloud.bolt.fill"
        case "thunderrain":  return "cloud.bolt.rain.fill"
        case "hail":         return "cloud.hail.fill"
        case "wind":         return "wind"
        case "smoke":        return "smoke.fill"
        default:             return "cloud.fill"
        }
    }
}
