import Foundation
import EvokerCore

/// UI texts of the menu screens, the client's strings as the web code quotes them (loca_en.json and the screen
/// modules of `Evoker Web/src/ui/screens`).
enum Strings {
    // Title (title.js)
    static let tapToContinue = "Tap to continue"
    static let webVersion = "iOS recreation"

    // Chrome (chrome.js, nav.js)
    static let back = "Back"
    static let help = "Help"
    static let profile = "Profile"
    static let shop = "Shop"
    static func unlocksAfterQuest(_ n: Int) -> String { "Unlocks after quest \(n)" }
    static func unlocksAtLevel(_ n: Int) -> String { "Unlocks at level \(n)" }
    static let staminaRefilled = "Stamina refilled!"
    static let manaRefilled = "Mana refilled!"
    static let notEnoughGems = "Not enough gems"
    static func potionBought(_ price: Int) -> String { "Potion bought and used (-\(price) gems)" }

    // Dialogs (dialog.js)
    static let confirm = "Confirm"
    static let ok = "OK"
    static let cancel = "Cancel"
    static let drinkPotion = "Drink potion"
    static let usePotionNow = "Use potion now"
    static func buyFor(_ price: Int) -> String { "Buy for \(fmtNumber(price))" }
    static func potionsCount(_ n: Int) -> String { "\(n) potion\(n == 1 ? "" : "s")" }
    static func potionLowUse(_ label: String) -> String { "Your \(label) is too low. Would you like to use one of your \(label) potions?" }
    static func potionLowBuy(_ label: String, price: Int) -> String { "Your \(label) is too low and you have no \(label) potions left. Buy one for \(fmtNumber(price)) gems?" }

    // Level-up (popup-levelup.js)
    static let levelUp = "Level up!"
    static func reachedLevel(_ n: Int) -> String { "Reached level \(n)" }
    static let rewards = "Rewards"
    static let points = "Points: "
    static let proceed = "Proceed"
    static let health = "Health"
    static let staminaLabel = "Stamina"
    static let manaLabel = "Mana"

    // Name popup (name-popup.js)
    static let namePrompt = "Before you enter the arena, Evoker, please tell me by which name the heralds shall refer to you:"
    static let yourName = "Your name"

    // Quest map (quest-map.js, quest-portal.js, quest-feed.js)
    static func beatQuestFirst(_ n: Int) -> String { "Beat quest \(n) first!" }
    static let portalsTitle = "Portals"
    static let portalsLocked = "Reach user level 8 to enter portals."
    static let portalClosed = "This portal has closed."
    static let dontMissReward = "DON'T MISS YOUR NEXT REWARD!"
    static let mainQuest = "Main Quest"
    static let portalClosesIn = "Portal closes in:"
    static let portalOpen = "Portal open"
    static let comingSoon = "Coming soon:"
    static let getCards = "Get Cards"
    static func opensSoon(_ name: String) -> String { "\(name) opens soon" }

    // Quest (quest.js, quest-model.js)
    static let beatMinionsFirst = "Beat the minions first!"
    static let noSuchQuest = "No such quest"
    static let questLocked = "Quest locked"
    static let allMinionsDefeated = "All minions defeated!"
    static let bossFight = "Boss fight!"
    static let perfect = "PERFECT"
    static let aNewCard = "A new card!"
    static let aPotion = "A potion!"
    static let aBoosterToken = "A booster token!"

    // Boss intro (boss-intro.js)
    static let showdown = "Showdown!"
    static func bossFightN(_ n: Int) -> String { "Boss Fight \(n)" }

    // Pre-battle (prebattle.js)
    static let attack = "Attack!"
    static let yourCards = "Your cards"
    static let dragHint = "drag a card into your deck"
    static let allCardsInDeck = "All your cards are in the deck."
    static let placeOneCard = "Place at least one card in your deck!"
    static let notEnoughMana = "Not enough mana"
    static let slotLocked = "This card slot is still locked."
    static let fightCouldNotStart = "The fight could not start"
    static func manaNeeded(_ need: Int, _ max: Int) -> String { "Mana needed: \(fmtNumber(need)) / \(fmtNumber(max))" }

    // Cards (cards.js, cards-helpers.js, cards-dnd.js, cards-ops.js)
    static let yourDeck = "Your Deck"
    static let cardTraining = "Card Training"
    static let fuseCards = "Fuse cards"
    static let trainingSlot = "Training slot"
    static let sacrificeStack = "Sacrifice stack"
    static let slot1 = "Slot 1"
    static let slot2 = "Slot 2"
    static func manaNeededText(_ mana: Int, _ max: Int) -> String { "Mana needed: \(mana) / \(max)" }
    static let incompleteCards = "You cannot use incomplete cards."
    static let manaTooLow = "Your maximum Mana is too low. You should increase your Mana next time you level up."
    static let stackFull = "You're not allowed to sacrifice more than \(Constants.maxSacrificeCards) cards at once."
    static let fuseMismatch = "You need two equal cards of the same evolution state to do this."
    static let trainingMissingBoth = "Add one card to the Training slot and at least one card to the Sacrifice slot."
    static let trainingMissingTrain = "Please add one card to the Training slot to do this."
    static let trainingMissingStack = "Add at least one card to the sacrifice stack to do this."
    static let sacrifice = "Sacrifice"
    static let notEnoughGold = "Not enough gold"
    static let needMoreGold = "You need more gold to do this!"
    static func shortOfGold(_ n: Int) -> String { "Short of \(fmtNumber(n)) gold" }
    static let levelUpLabel = "LEVEL UP"
    static let fused = "FUSED"

    // Card detail (card-detail.js)
    static let zoom = "Zoom"
    static let sellCard = "Sell card"
    static let sell = "Sell"
    static let inYourDeck = "In your deck"
    static func sellsFor(_ n: Int) -> String { "Sells for \(fmtNumber(n))" }
    static let catalogCard = "Catalog card"
    static let cardsInDeckNoSell = "Cards in your deck cannot be sold"
    static func soldFor(_ n: Int) -> String { "Sold for \(fmtNumber(n)) gold" }
    static let tapToClose = "Tap to close"
    static let noAbility = "No ability."
    static let cardGone = "This card is no longer in your collection."
    static let unknownCard = "Unknown card."

    // Collections (collections.js)
    static let reward = "Reward:"
    static let claim = "Claim"
    static let claimed = "Claimed"
    static let noSets = "No card sets are available."

    // Arena (arena.js, arena-pieces.js, pvp-widgets.js)
    static let arena = "Arena"
    static let pieces = "Pieces"
    static let replays = "Replays"
    static let emptyArena = "Sorry, there are currently no enemies in your range."
    static let emptyHistory = "Sorry, you don't have a fight history yet."
    static let opponentGone = "That opponent is gone. New opponents found."
    static let noHolder = "Sorry, there is no opponent with your needed card-piece."
    static let assemble = "Assemble"
    static let watch = "Watch"
    static let replayBroken = "This replay can no longer be played."
    static let rerollOpponent = "Reroll opponent"
    static let fightsWon = "Fights Won"
    static let quests = "Quests"
    static let noCards = "No cards"
    static let needGemsNewEnemy = "You need more Gems to get a new enemy!"
    static let needGemsNewPiece = "You need more Gems to get a new card-piece!"
    static let allPieceSlotsUsed = "All piece slots are in use."
    static let buyPieces = "Buy pieces"
    static let buy = "Buy"
    static let getMore = "Get more"
    static let cardComplete = "Card complete!"
    static let great = "Great!"
    static let allPiecesCollected = "All pieces collected! The card has been added to your collection."
    static let youAttacked = "You attacked"

    // League (league.js)
    static let finished = "FINISHED"
    static let rules = "RULES"
    static let prizes = "PRIZES"
    static let congratulations = "Congratulations!"
    static let joinLeague = "Join League"
    static let leaguesUnlocked = "Leagues Unlocked!"
    static let leagueDesc1 = "Defeat other players to earn points!"
    static let leagueDesc2 = "The three best players of a league advance to the next league."
    static let enterNextLeague = "Enter the next league:"
    static let takeRewardNextLeague = "Take your Reward and enter the next League:"
    static let loading = "Loading..."

    // Shop (shop.js, booster-open.js)
    static let needMoreTokens = "Need more Tokens?\nVisit the Shop!"
    static let lookInside = "Look inside"
    static let mayContain = "May contain:"
    static let offerEndsIn = "Offer ends in"
    static let comingSoonPlain = "Coming soon"
    static let setCollections = "Set collections"
    static let completeSetForGems = "Complete a set for gems"
    static let greatPotionDeal = "Great Potion Deal"
    static let gemsTitle = "Gems"
    static let noPurchases = "Purchases are not available in this offline version. Gems come from daily rewards, level-ups, league prizes, boss drops and set collections."
    static let needGemsBooster = "You need more Gems to get a booster card!"
    static let openNewBooster = "Do you want to open a new booster?"
    static let cardAddedToSet = "Card added to set:"
    static let boosterFailed = "This booster could not be opened."
    static let backToShop = "Back to shop"
    static let newBooster = "New booster"
    static let threePotionsAdded = "3 potions added to your bag!"

    // Character (character.js, character-profile.js, character-settings.js)
    static let bestCard = "Best card"
    static let stats = "Stats"
    static let bonus = "Bonus"
    static let quest = "Quest"
    static let battlesWon = "Battles won"
    static let support = "Support"
    static let chooseAvatar = "Choose your avatar"
    static let changeName = "Change name"
    static let howShallRealmKnowYou = "How shall the realm know you?"
    static let enterAName = "Please enter a name."
    static func welcome(_ name: String) -> String { "Welcome, \(name)!" }
    static let statPoints = "Stat points"
    static let options = "Options"
    static let musicVolume = "Music Volume"
    static let fxVolume = "FX Volume"
    static let battleSpeed = "Battle speed"
    static let sound = "Sound"
    static let soundHint = "Music and sound effects."
    static let simulatedRaids = "Simulated raids"
    static let raidsHint = "Other players may steal a card piece per day."
    static let reducedMotion = "Reduced motion"
    static let reducedMotionHint = "Shorter animations and no flips."
    static let exportSave = "Export save"
    static let importSave = "Import save"
    static let resetProgress = "Reset progress"
    static let resetMessage = "Delete your whole progress and start over? All cards, gold and gems will be lost."
    static let areYouSure = "Are you sure?"
    static let resetMessage2 = "This really cannot be undone. Reset everything now?"
    static let yesReset = "Yes, reset"
    static let reset = "Reset"
    static let progressReset = "Progress reset"
    static let saveExported = "Save exported"
    static let saveImported = "Save imported"
    static let importFailed = "Import failed"
    static let about = "An offline fan recreation of flaregames' Evoker (client 1.7.4). Your progress is saved on this device only."
    static let dailyRewards = "Daily rewards"
    static let claimReward = "Claim reward"
    static let comeBackTomorrow = "Come back tomorrow"
    static let claimedToday = "Claimed today"
    static let alreadyClaimed = "Already claimed today."
    static let dailyHint = "Log in every day to keep your streak. The rewards repeat every 21 days; missing a day starts again at day 1."

    // Help (help.js)
    static let otherTopics = "Other topics"

    // Lab (lab.js)
    static let cardLab = "Card Lab"
    static let labHint = "Pick a card: it is placed in the middle of your row between two plain allies, with five plain attackers opposite. Change any slot, then Fight!"
    static let fight = "Fight!"
    static let sameFightAgain = "Same fight again"
    static let autoSetup = "Auto set-up"
    static let opponentRow = "Opponent row"
    static let yourRow = "Your row"
    static let noFightYet = "No fight yet."
    static let putOneCard = "Put at least one card in your row"
    static let pickACard = "Pick a card to test."

    // Notices (app.js noticeText)
    static func leagueFinished(rank: Int) -> String { "League finished: rank \(rank)" }
    static func pieceStolen(_ name: String) -> String { "A piece of \(name) was stolen!" }
}
