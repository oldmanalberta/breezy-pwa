import WidgetKit
import SwiftUI

// MARK: - the app's card look
//
// Colours and type follow css/app.css: a tonal surface in place of the sky,
// the accent for headings and curves, Aileron for everything.

struct Theme {
    let scheme: ColorScheme
    /// The app's chosen accent as [light, dark], or nil for the default.
    var tint: [UInt32]? = nil
    var surface: Color      { scheme == .dark ? Color(hex: 0x171B22) : .white }
    var surface2: Color     { scheme == .dark ? Color(hex: 0x1E232C) : Color(hex: 0xEEF2F7) }
    var ink: Color          { scheme == .dark ? Color(hex: 0xE3E6EA) : Color(hex: 0x161A20) }
    var inkVar: Color       { scheme == .dark ? Color(hex: 0xA8B0BB) : Color(hex: 0x5A6472) }
    var accent: Color {
        if let t = tint, t.count == 2 { return Color(hex: scheme == .dark ? t[1] : t[0]) }
        return scheme == .dark ? Color(hex: 0x8AB4F8) : Color(hex: 0x3F6288)
    }
    var outline: Color      { scheme == .dark ? Color(hex: 0x333A45) : Color(hex: 0xD6DDE6) }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255)
    }
}

enum Aileron {
    static func light(_ s: CGFloat) -> Font { .custom("Aileron-Light", size: s) }
    static func regular(_ s: CGFloat) -> Font { .custom("Aileron-Regular", size: s) }
    static func bold(_ s: CGFloat) -> Font { .custom("Aileron-Bold", size: s) }
}

/// The app's own weather art, rasterised from js/icons.js into the asset
/// catalog as wx-<key> and wx-<key>-night.
struct WxIcon: View {
    let key: String
    var night = false
    var size: CGFloat = 27

    var body: some View {
        Image(night ? "wx-\(key)-night" : "wx-\(key)")
            .resizable()
            .interpolation(.high)
            .frame(width: size, height: size)
    }
}

/// "7-DAY FORECAST" with its little glyph, as the card head in the app.
struct CardHead: View {
    let title: String
    let symbol: String
    let theme: Theme

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: symbol).font(.system(size: 12, weight: .bold))
            Text(title.uppercased()).font(Aileron.bold(12)).tracking(1.1)
        }
        .foregroundStyle(theme.accent)
    }
}

/// Shown when the app has never published — the widget is added before the
/// app has been opened, or the App Group is not configured on this build.
struct EmptyState: View {
    let theme: Theme
    var body: some View {
        VStack(spacing: 6) {
            WxIcon(key: "partly", size: 36)
            Text("Open Breezy once to fill this in").font(Aileron.regular(12)).multilineTextAlignment(.center)
        }
        .foregroundStyle(theme.inkVar)
        .padding()
    }
}

/// Two polylines with value labels, the way the daily card draws highs and
/// lows across its columns. `cols` is the column pitch the labels sit on.
struct RangeCurve: View {
    let hi: [Int?]
    let lo: [Int?]
    let theme: Theme
    var labelSize: CGFloat = 13
    /// Room kept above and below the line for the labels. The plotting band is
    /// what is left, so it must stay positive or the line comes out upside down.
    var padT: CGFloat = 20
    var padB: CGFloat = 20

    var body: some View {
        GeometryReader { geo in
            let n = max(hi.count, 1)
            let col = geo.size.width / CGFloat(n)
            let vals = (hi + lo).compactMap { $0 }
            let mn = vals.min() ?? 0, mx = max(vals.max() ?? 1, (vals.min() ?? 0) + 1)
            let band = max(geo.size.height - padT - padB, 4)
            let y: (Int) -> CGFloat = { v in
                padT + (1 - CGFloat(v - mn) / CGFloat(mx - mn)) * band
            }
            let x: (Int) -> CGFloat = { i in CGFloat(i) * col + col / 2 }

            ZStack(alignment: .topLeading) {
                line(hi, x: x, y: y).stroke(theme.accent, style: .init(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                line(lo, x: x, y: y).stroke(theme.accent.opacity(0.55), style: .init(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                ForEach(Array(hi.enumerated()), id: \.offset) { i, v in
                    if let v {
                        Text("\(v)°").font(Aileron.bold(labelSize)).foregroundStyle(theme.ink)
                            .position(x: x(i), y: y(v) - 13)
                    }
                }
                ForEach(Array(lo.enumerated()), id: \.offset) { i, v in
                    if let v {
                        Text("\(v)°").font(Aileron.bold(labelSize)).foregroundStyle(theme.ink)
                            .position(x: x(i), y: y(v) + 13)
                    }
                }
            }
        }
    }

    private func line(_ arr: [Int?], x: (Int) -> CGFloat, y: (Int) -> CGFloat) -> Path {
        var p = Path()
        var started = false
        for (i, v) in arr.enumerated() {
            guard let v else { continue }
            let pt = CGPoint(x: x(i), y: y(v))
            if started { p.addLine(to: pt) } else { p.move(to: pt); started = true }
        }
        return p
    }
}

/// One temperature polyline with labels above, the hourly card's spark.
struct SparkCurve: View {
    let temps: [Int?]
    let theme: Theme

    var body: some View {
        // only labels above the line here, so it needs little room below
        RangeCurve(hi: temps, lo: [], theme: theme, labelSize: 12.5, padT: 18, padB: 4)
    }
}

/// Current conditions on one line — temperature, icon, wording, high/low —
/// the way the hero summarises them above the cards.
struct NowLine: View {
    let f: Forecast
    let theme: Theme
    var big: CGFloat = 26

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            Text(Fmt.deg(f.current.temp)).font(Aileron.light(big)).foregroundStyle(theme.ink)
            WxIcon(key: f.current.condition, night: f.current.night, size: big * 0.95)
            VStack(alignment: .leading, spacing: 0) {
                Text(f.current.text).font(Aileron.bold(12)).foregroundStyle(theme.ink).lineLimit(1)
                Text("H \(Fmt.deg(f.current.hi))  ·  L \(Fmt.deg(f.current.lo))  ·  \(f.place)")
                    .font(Aileron.regular(11)).foregroundStyle(theme.inkVar).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Forecast widget

struct ForecastView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme
    let entry: BreezyEntry

    var body: some View {
        let theme = Theme(scheme: scheme, tint: entry.forecast?.accent)
        if let f = entry.forecast {
            switch family {
            case .systemSmall: small(f, theme)
            case .systemMedium: medium(f, theme)
            default: large(f, theme)
            }
        } else {
            EmptyState(theme: theme)
        }
    }

    private func dayName(_ d: Forecast.Day, first: Bool, tz: TimeZone) -> String {
        if first { return "Today" }
        let wd = Fmt.weekday(d.d, tz: tz)
        return wd.isEmpty ? String((d.label ?? "").prefix(3)) : wd
    }

    /// Current conditions in the card's voice, for the small size.
    private func small(_ f: Forecast, _ t: Theme) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(f.place).font(Aileron.bold(12)).foregroundStyle(t.inkVar).lineLimit(1)
            HStack(alignment: .center, spacing: 8) {
                Text(Fmt.deg(f.current.temp)).font(Aileron.light(40)).foregroundStyle(t.ink)
                WxIcon(key: f.current.condition, night: f.current.night, size: 40)
            }
            Text(f.current.text).font(Aileron.regular(12)).foregroundStyle(t.ink).lineLimit(1)
            Text("H \(Fmt.deg(f.current.hi))  ·  L \(Fmt.deg(f.current.lo))").font(Aileron.bold(12)).foregroundStyle(t.inkVar)
            if let a = f.alert {
                Spacer(minLength: 0)
                Text(a).font(Aileron.bold(11)).foregroundStyle(Color(hex: 0xE4573D)).lineLimit(1)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// The whole week in the 2×4: current conditions on the head row, then
    /// seven tight columns with the high/low curve through them.
    private func medium(_ f: Forecast, _ t: Theme) -> some View {
        let days = Array(f.daily.prefix(7))
        return VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .center, spacing: 6) {
                CardHead(title: "\(days.count)-day forecast", symbol: "calendar", theme: t)
                Spacer(minLength: 4)
                Text(Fmt.deg(f.current.temp)).font(Aileron.light(19)).foregroundStyle(t.ink)
                WxIcon(key: f.current.condition, night: f.current.night, size: 19)
                Text(f.current.text).font(Aileron.bold(11)).foregroundStyle(t.inkVar).lineLimit(1)
            }
            HStack(spacing: 0) {
                ForEach(Array(days.enumerated()), id: \.offset) { i, d in
                    VStack(spacing: 1) {
                        Text(dayName(d, first: i == 0, tz: f.timeZone)).font(Aileron.bold(11)).foregroundStyle(i == 0 ? t.accent : t.ink)
                        WxIcon(key: d.condition, size: 22)
                    }
                    .lineLimit(1).minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity)
                }
            }
            RangeCurve(hi: days.map { $0.hi }, lo: days.map { $0.lo }, theme: t, labelSize: 11)
                .frame(height: 74)
            HStack(spacing: 0) {
                ForEach(Array(days.enumerated()), id: \.offset) { _, d in
                    Text(d.pop.map { $0 > 5 ? "\($0)%" : " " } ?? " ").font(Aileron.bold(10)).foregroundStyle(t.accent)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// The 4×4: the daily card, then the hourly strip beneath it.
    private func large(_ f: Forecast, _ t: Theme) -> some View {
        let days = Array(f.daily.prefix(7))
        let hours = f.hours(from: entry.date, count: 6)
        return VStack(alignment: .leading, spacing: 3) {
            CardHead(title: "\(days.count)-day forecast", symbol: "calendar", theme: t)
            NowLine(f: f, theme: t, big: 24)
                .padding(.top, 2).padding(.bottom, 12)   // room between now and the week
            HStack(spacing: 0) {
                ForEach(Array(days.enumerated()), id: \.offset) { i, d in
                    VStack(spacing: 1) {
                        Text(dayName(d, first: i == 0, tz: f.timeZone)).font(Aileron.bold(12)).foregroundStyle(i == 0 ? t.accent : t.ink)
                        Text(Fmt.monthDay(d.d, tz: f.timeZone)).font(Aileron.regular(9.5)).foregroundStyle(t.inkVar)
                        WxIcon(key: d.condition, size: 24)
                    }
                    .lineLimit(1).minimumScaleFactor(0.75)
                    .frame(maxWidth: .infinity)
                }
            }
            RangeCurve(hi: days.map { $0.hi }, lo: days.map { $0.lo }, theme: t, labelSize: 12)
                .frame(height: 80)
            HStack(spacing: 0) {
                ForEach(Array(days.enumerated()), id: \.offset) { _, d in
                    HStack(spacing: 3) {
                        WxIcon(key: d.condition, night: true, size: 18).opacity(0.72)
                        Text(d.pop.map { $0 > 5 ? "\($0)%" : "" } ?? "").font(Aileron.bold(10)).foregroundStyle(t.accent)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            if let a = f.alert {
                Text(a).font(Aileron.bold(11)).foregroundStyle(Color(hex: 0xE4573D)).lineLimit(1)
            }
            Rectangle().fill(t.outline).frame(height: 1).padding(.top, 6).padding(.bottom, 4)
            CardHead(title: "Hourly forecast", symbol: "clock", theme: t)
            HourStrip(f: f, hours: hours, theme: t, firstIsNow: true, sparkHeight: 36, iconSize: 20)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Hourly widget

struct HourlyView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme
    let entry: BreezyEntry

    var body: some View {
        let t = Theme(scheme: scheme, tint: entry.forecast?.accent)
        if let f = entry.forecast {
            let hours = f.hours(from: entry.date, count: family == .systemLarge ? 12 : 6)
            VStack(alignment: .leading, spacing: 4) {
                CardHead(title: "Hourly forecast", symbol: "clock", theme: t)
                HourStrip(f: f, hours: Array(hours.prefix(6)), theme: t, firstIsNow: true)
                if family == .systemLarge && hours.count > 6 {
                    HourStrip(f: f, hours: Array(hours.dropFirst(6)), theme: t, firstIsNow: false)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else {
            EmptyState(theme: t)
        }
    }

}

/// The hourly card's shape: temperature spark with labels, then the icon,
/// chance of precipitation, and the hour under each column.
struct HourStrip: View {
    let f: Forecast
    let hours: [Forecast.Hour]
    let theme: Theme
    var firstIsNow = true
    var sparkHeight: CGFloat = 52
    var iconSize: CGFloat = 28

    var body: some View {
        VStack(spacing: 0) {
            SparkCurve(temps: hours.map { $0.temp }, theme: theme).frame(height: sparkHeight)
            HStack(spacing: 0) {
                ForEach(Array(hours.enumerated()), id: \.offset) { i, h in
                    VStack(spacing: 1) {
                        WxIcon(key: h.condition, night: h.night, size: iconSize)
                        Text(h.pop.map { $0 > 5 ? "\($0)%" : " " } ?? " ").font(Aileron.bold(10.5)).foregroundStyle(theme.accent)
                        Text(firstIsNow && i == 0 ? "Now" : Fmt.hour(h.t, tz: f.timeZone))
                            .font(Aileron.bold(11)).foregroundStyle(firstIsNow && i == 0 ? theme.accent : theme.inkVar)
                    }
                    .lineLimit(1).minimumScaleFactor(0.8)
                    .frame(maxWidth: .infinity)
                }
            }
        }
    }
}

// MARK: - Lock Screen

struct LockView: View {
    @Environment(\.widgetFamily) private var family
    let entry: BreezyEntry

    var body: some View {
        let f = entry.forecast ?? .sample
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: WeatherSymbol.name(f.current.condition, night: f.current.night))
                        .font(.system(size: 16))
                    Text(Fmt.deg(f.current.temp)).font(.system(size: 15, weight: .semibold, design: .rounded))
                }
            }
        case .accessoryInline:
            Text("\(Image(systemName: WeatherSymbol.name(f.current.condition, night: f.current.night))) \(Fmt.deg(f.current.temp)) \(f.current.text)")
        default:
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Image(systemName: WeatherSymbol.name(f.current.condition, night: f.current.night))
                    Text(f.place).fontWeight(.semibold)
                }
                .font(.caption)
                Text("\(Fmt.deg(f.current.temp)) \(f.current.text)").font(.headline)
                Text("H \(Fmt.deg(f.current.hi))  L \(Fmt.deg(f.current.lo))").font(.caption)
            }
            .lineLimit(1)
        }
    }
}
