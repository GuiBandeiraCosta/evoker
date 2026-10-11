import SwiftUI
import EvokerCore

/// The 21-day daily reward calendar (`src/ui/screens/daily-view.js` + the daily view of `character.js`).
struct DailyCalendar {
    struct Cell: Identifiable {
        enum Status { case claimed, today, claimedToday, future }
        let index: Int
        let day: Int
        let reward: DailyReward
        let status: Status
        var id: Int { index }
    }

    var cells: [Cell]
    var claimable: Bool
    var claimedToday: Bool
    var streak: Int
    var nextDay: Int
    var position: Int
    var reward: DailyReward
    var nextReward: DailyReward
    var startsTomorrow: Bool

    /// `dailyCalendar(daily, now)`.
    init(daily: DailyState, now: Int64) {
        let cycle = max(1, ShopOps.dailyRewards.count)
        let today = JSDate.utcDay(now)
        let yesterday = JSDate.previousDay(today)
        let streak = max(0, daily.streak)
        let claimedToday = daily.lastClaim == today && streak > 0
        let startsTomorrow = daily.lastClaim == today && streak == 0
        var nextDay: Int
        var claimable: Bool
        var shown: Int
        if startsTomorrow {
            nextDay = 1; claimable = false; shown = 0
        } else if claimedToday {
            nextDay = max(1, streak); claimable = false; shown = streak
        } else if daily.lastClaim == yesterday && streak > 0 {
            nextDay = streak + 1; claimable = true; shown = streak
        } else {
            nextDay = 1; claimable = true; shown = 0
        }
        let cycleIndex = (nextDay - 1) / cycle
        let position = ((nextDay - 1) % cycle) + 1
        var cells: [Cell] = []
        for i in 1...cycle {
            let day = cycleIndex * cycle + i
            let status: Cell.Status = i < position ? .claimed : (i == position ? (claimedToday ? .claimedToday : .today) : .future)
            cells.append(Cell(index: i, day: day, reward: ShopOps.dailyRewardFor(day: day), status: status))
        }
        self.cells = cells
        self.claimable = claimable
        self.claimedToday = claimedToday
        self.streak = shown
        self.nextDay = nextDay
        self.position = position
        self.reward = ShopOps.dailyRewardFor(day: nextDay)
        self.nextReward = ShopOps.dailyRewardFor(day: claimedToday ? nextDay + 1 : nextDay)
        self.startsTomorrow = startsTomorrow
    }
}

struct DailyView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        if let state = model.store.state {
            let cal = DailyCalendar(daily: state.daily, now: model.now)
            let cycle = max(1, ShopOps.dailyRewards.count)
            VStack(spacing: 14) {
                if let ev = model.dailyEvent {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 0) {
                            Text("Event: ").font(Theme.font(28)).foregroundColor(Theme.muted)
                            Text(ev.name).font(Theme.font(28)).foregroundColor(Color(hex: 0xdff2ff))
                        }
                        Text(ev.desc).font(Theme.light(19)).foregroundColor(Color(hex: 0xbfe6ff))
                    }
                    .padding(.leading, 30).padding(.trailing, 20)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(height: 80)
                    .background(LinearGradient(colors: [Color(hex: 0x143c5a, alpha: 0.95), Color(hex: 0x3c5a6e, alpha: 0.8), Color(hex: 0x1e3246, alpha: 0.9)], startPoint: .leading, endPoint: .trailing))
                    .overlay(NineSlice(Theme.Frames.glowBlue))
                    .padding(.horizontal, 6)
                }
                Panel {
                    VStack(spacing: 10) {
                        HStack {
                            HStack(spacing: 0) {
                                Text("Streak: ").font(Theme.font(24))
                                Text("\(cal.streak)").font(Theme.num(30)).foregroundColor(Theme.gold)
                                Text(" day\(cal.streak == 1 ? "" : "s")").font(Theme.font(24)).foregroundColor(Theme.muted)
                            }
                            Spacer()
                            HStack(spacing: 0) {
                                Text(cal.claimedToday || cal.startsTomorrow ? "Come back tomorrow for " : "Today: ").font(Theme.light(20))
                                Text(DailyRewardText.describe(cal.nextReward)).font(Theme.light(20)).foregroundColor(Theme.gold)
                            }
                        }
                        .foregroundColor(Theme.text)
                        Text(Strings.dailyHint).font(Theme.light(16)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
                        SteelButton(cal.claimable ? Strings.claimReward : (cal.startsTomorrow ? Strings.comeBackTomorrow : Strings.claimedToday), variant: cal.claimable ? .green : .grey, size: .lg, disabled: !cal.claimable) {
                            Task { @MainActor in await claim() }
                        }
                        .frame(minWidth: 340)
                    }
                    .padding(.vertical, 14).padding(.horizontal, 16)
                }
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                    ForEach(cal.cells) { c in
                        VStack(spacing: 3) {
                            HStack(spacing: 2) {
                                Text("Day \(c.index)").font(Theme.font(16)).foregroundColor(c.status == .today ? Theme.tierGold : (c.status == .future ? Theme.muted : Theme.hp))
                                if c.index % cycle == 0 { Text("★").font(Theme.font(16)).foregroundColor(Theme.tierGold) }
                            }
                            HStack(spacing: 6) {
                                ForEach(Array(DailyRewardText.icons(c.reward).enumerated()), id: \.offset) { item in
                                    HStack(spacing: 2) {
                                        Sprite(item.element.sprite).frame(width: 36, height: 36)
                                        if item.element.count > 1 || item.element.gem {
                                            Text(item.element.gem ? "\(item.element.count)" : "×\(item.element.count)").font(Theme.num(18)).foregroundColor(Theme.text)
                                        }
                                    }
                                }
                            }
                            Text(DailyRewardText.describe(c.reward)).font(Theme.light(14)).foregroundColor(Theme.tan).multilineTextAlignment(.center)
                        }
                        .padding(.vertical, 8).padding(.horizontal, 6)
                        .frame(maxWidth: .infinity, minHeight: 118)
                        .background(Color(hex: 0x141618, alpha: 0.9))
                        .overlay(NineSlice(Theme.Frames.ironframe))
                        .overlay(c.status == .today || c.status == .claimedToday ? AnyView(NineSlice(c.status == .today ? Theme.Frames.glowGold : Theme.Frames.glowBlue).padding(-10).opacity(0.85).allowsHitTesting(false)) : AnyView(EmptyView()))
                        .overlay(alignment: .topTrailing) {
                            if c.status == .claimed || c.status == .claimedToday {
                                Text("✓").font(Theme.font(16)).foregroundColor(.white).frame(width: 26, height: 26)
                                    .background(Circle().fill(RadialGradient(colors: [Color(hex: 0x6fe06f), Color(hex: 0x2d7a24)], center: UnitPoint(x: 0.35, y: 0.3), startRadius: 0, endRadius: 14)))
                                    .overlay(Circle().stroke(Color(hex: 0x0a0b0c), lineWidth: 2))
                                    .padding(4)
                            }
                        }
                        .brightness(c.status == .claimed ? -0.12 : 0)
                        .saturation(c.status == .claimed ? 0.6 : 1)
                    }
                }
            }
        }
    }

    private func claim() async {
        let info: DailyClaim? = model.update { s, _, t in
            let r = ShopOps.claimDaily(s, now: t)
            return (state: r.state, info: r.info)
        }
        guard let c = info, c.claimed, let reward = c.reward else {
            model.toast(Strings.alreadyClaimed)
            return
        }
        model.sfx("quest_reward_collect")
        var r = DialogRequest()
        r.title = "Day \(c.day) reward"
        r.body = { _ in
            AnyView(VStack(spacing: 14) {
                HStack(spacing: 16) {
                    ForEach(Array(DailyRewardText.icons(reward).enumerated()), id: \.offset) { item in
                        HStack(spacing: 2) {
                            Sprite(item.element.sprite).frame(width: 72, height: 72)
                            Text(item.element.gem ? "\(item.element.count)" : "×\(item.element.count)").font(Theme.num(30)).foregroundColor(Theme.text)
                        }
                    }
                }
                Text("You received \(DailyRewardText.describe(reward))!").font(Theme.font(26)).foregroundColor(Theme.text).multilineTextAlignment(.center)
            })
        }
        r.buttons = [DialogButton(Strings.great, value: "ok")]
        _ = await model.dialogs.open(r)
    }
}
