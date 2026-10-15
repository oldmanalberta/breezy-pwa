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
    var accent: [UInt32]?
    var lat: Double?
    var lon: Double?
    /// When the app last wrote this snapshot, and when the widget last
    /// refreshed it on its own. ECCC's `updated` is the issue time, which can
    /// be hours old on a perfectly fresh forecast, so age goes by these.
    var published: Date?
    var fetched: Date?

    static let appGroup = "group.ca.oldmanalberta.breezy"
    static let key = "forecast"
    /// How old the data may get before the widget fetches its own.
    static let staleAfter: TimeInterval = 30 * 60

    var age: TimeInterval {
        let last = [published, fetched].compactMap { $0 }.max() ?? updated
        return Date().timeIntervalSince(last)
    }

    func save() {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        guard let data = try? e.encode(self), let json = String(data: data, encoding: .utf8) else { return }
        UserDefaults(suiteName: Forecast.appGroup)?.set(json, forKey: Forecast.key)
    }

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

    /// Today onward in the forecast's own time zone, so yesterday drops off
    /// at midnight even when nothing new has arrived.
    func days(from date: Date) -> [Day] {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let start = cal.startOfDay(for: date)
        return daily.filter { d in
            guard let t = d.d else { return true }
            return t >= start || cal.isDate(t, inSameDayAs: date)
        }
    }

    func isToday(_ d: Day, at date: Date) -> Bool {
        guard let t = d.d else { return false }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        return cal.isDate(t, inSameDayAs: date)
    }

    // MARK: refreshing without the app

    private struct OM: Decodable {
        struct Cur: Decodable {
            var temperature_2m: Double?
            var apparent_temperature: Double?
            var weather_code: Int?
            var is_day: Int?
        }
        struct Hr: Decodable {
            var time: [Double]
            var temperature_2m: [Double?]
            var weather_code: [Int?]
            var precipitation_probability: [Double?]?
            var is_day: [Int?]?
        }
        struct Dy: Decodable {
            var time: [Double]
            var weather_code: [Int?]
            var temperature_2m_max: [Double?]
            var temperature_2m_min: [Double?]
            var precipitation_probability_max: [Double?]?
        }
        var timezone: String?
        var current: Cur
        var hourly: Hr
        var daily: Dy
    }

    /// A fresh copy from Open-Meteo for the same place, keeping the app's
    /// name, unit and colours. Nil when there is no location or the fetch
    /// fails, in which case the widget keeps what it has.
    func refreshed() async -> Forecast? {
        guard let lat, let lon else { return nil }
        var q = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        q.queryItems = [
            .init(name: "latitude", value: String(lat)),
            .init(name: "longitude", value: String(lon)),
            .init(name: "current", value: "temperature_2m,apparent_temperature,weather_code,is_day"),
            .init(name: "hourly", value: "temperature_2m,weather_code,precipitation_probability,is_day"),
            .init(name: "daily", value: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"),
            .init(name: "timezone", value: tz ?? "auto"),
            .init(name: "timeformat", value: "unixtime"),
            .init(name: "forecast_days", value: "8"),
        ]
        if unit == "°F" { q.queryItems?.append(.init(name: "temperature_unit", value: "fahrenheit")) }
        guard let url = q.url else { return nil }
        var req = URLRequest(url: url)
        req.timeoutInterval = 12
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let om = try? JSONDecoder().decode(OM.self, from: data) else { return nil }

        let now = Date()
        func r(_ v: Double?) -> Int? { v.map { Int($0.rounded()) } }
        func at<T>(_ a: [T?]?, _ i: Int) -> T? { guard let a, i < a.count else { return nil }; return a[i] }

        let H = om.hourly
        var hours: [Hour] = []
        for (i, t) in H.time.enumerated() {
            let d = Date(timeIntervalSince1970: t)
            guard d >= now.addingTimeInterval(-3600) else { continue }
            let code = at(H.weather_code, i) ?? 3
            hours.append(Hour(t: d, temp: r(at(H.temperature_2m, i)), condition: Wmo.key(code),
                              night: at(H.is_day, i) == 0, pop: r(at(H.precipitation_probability, i))))
            if hours.count == 30 { break }
        }

        var next = self
        next.tz = om.timezone ?? tz
        let D = om.daily
        let days = D.time.enumerated().map { i, t in
            Day(d: Date(timeIntervalSince1970: t), label: nil,
                hi: r(at(D.temperature_2m_max, i)), lo: r(at(D.temperature_2m_min, i)),
                condition: Wmo.key(at(D.weather_code, i) ?? 3),
                pop: r(at(D.precipitation_probability_max, i)))
        }
        next.daily = days
        next.daily = Array(next.days(from: now).prefix(7))
        let today = next.daily.first(where: { next.isToday($0, at: now) })
        let c = om.current
        let code = c.weather_code ?? 3
        next.current = Current(temp: r(c.temperature_2m), feels: r(c.apparent_temperature),
                               condition: Wmo.key(code), night: c.is_day == 0, text: Wmo.text(code),
                               hi: today?.hi, lo: today?.lo)
        next.hourly = hours
        next.updated = now
        next.fetched = now
        // the app's warning can't be checked from here; drop it once the app
        // hasn't been opened for a while rather than show a stale one
        if now.timeIntervalSince(published ?? updated) > 6 * 3600 { next.alert = nil }
        return next
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

// MARK: - WMO code → condition (mirrors js/icons.js)

enum Wmo {
    static func key(_ c: Int) -> String {
        switch c {
        case 0: return "clear"
        case 1: return "mainlyclear"
        case 2: return "partly"
        case 3: return "overcast"
        case 45, 48: return "fog"
        case 51, 53, 55: return "drizzle"
        case 56, 57, 66, 67: return "freezing"
        case 61, 63: return "rain"
        case 65, 82: return "heavyrain"
        case 71, 73, 77: return "snow"
        case 75, 86: return "heavysnow"
        case 80, 81: return "rainshower"
        case 85: return "snowshower"
        case 95: return "thunder"
        case 96, 99: return "hail"
        default: return "cloudy"
        }
    }

    static func text(_ c: Int) -> String {
        switch c {
        case 0: return "Clear"
        case 1: return "Mainly clear"
        case 2: return "Partly cloudy"
        case 3: return "Overcast"
        case 45: return "Fog"
        case 48: return "Depositing rime fog"
        case 51: return "Light drizzle"
        case 53: return "Drizzle"
        case 55: return "Dense drizzle"
        case 56: return "Freezing drizzle"
        case 57: return "Dense freezing drizzle"
        case 61: return "Light rain"
        case 63: return "Rain"
        case 65: return "Heavy rain"
        case 66: return "Freezing rain"
        case 67: return "Heavy freezing rain"
        case 71: return "Light snow"
        case 73: return "Snow"
        case 75: return "Heavy snow"
        case 77: return "Snow grains"
        case 80: return "Light showers"
        case 81: return "Showers"
        case 82: return "Violent showers"
        case 85: return "Snow showers"
        case 86: return "Heavy snow showers"
        case 95: return "Thunderstorm"
        case 96: return "Thunderstorm with hail"
        case 99: return "Severe thunderstorm"
        default: return "Cloudy"
        }
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
