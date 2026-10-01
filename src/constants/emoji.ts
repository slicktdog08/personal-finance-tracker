// Curated set of native unicode emoji for the picker. No dependency — the OS font
// renders these. Grouped so the picker can show labeled sections; `keywords` makes a
// few non-obvious ones searchable beyond their visible glyph.

export interface EmojiGroup {
  label: string;
  emojis: string[];
  // Optional search aliases, keyed by emoji, to widen matches in the picker search box.
  keywords?: Record<string, string>;
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    label: "Money & Finance",
    emojis: [
      "💵", "💴", "💶", "💷", "💰", "💸", "💳", "🪙", "🧾", "🏦", "🏧", "💱", "💲",
      "📈", "📉", "📊", "💹", "🤑", "🪪", "🔖", "🧮",
    ],
    keywords: {
      "💵": "cash dollar money",
      "💳": "credit card payment",
      "🏦": "bank ach",
      "🧾": "receipt fees bill invoice",
      "📈": "chart up interest growth",
      "📉": "chart down loss",
      "📊": "chart investing stats",
      "🤑": "rich money",
    },
  },
  {
    label: "Home & Bills",
    emojis: [
      "🏠", "🏡", "🏢", "🏘️", "🔑", "🛋️", "🛏️", "🚪", "💡", "⚡", "🔌", "🔋",
      "🚿", "🚰", "🔥", "❄️", "🗑️", "📦", "🧺", "🧹", "🧴", "🪣",
    ],
    keywords: {
      "🏠": "home rent house",
      "⚡": "electric utilities power energy",
      "💡": "light electric utilities",
      "🔥": "gas heat utilities",
      "🚰": "water utilities",
      "📦": "package shipping amazon",
    },
  },
  {
    label: "Food & Shopping",
    emojis: [
      "🍔", "🍕", "🌮", "🍜", "🍳", "🛒", "🛍️", "🥡", "☕", "🍺", "🍷", "🥑",
      "🧋", "🍎", "🥦", "🍞", "🛒", "🏷️", "🎁", "💐",
    ],
    keywords: {
      "🍔": "food burger fast food",
      "🛒": "groceries shopping cart essentials",
      "🛍️": "shopping discretionary retail",
      "☕": "coffee cafe",
      "🏷️": "tag price discount",
      "🎁": "gift reward",
    },
  },
  {
    label: "Transport & Travel",
    emojis: [
      "🚗", "🚙", "🚕", "🚌", "🚆", "✈️", "🛫", "⛽", "🚲", "🛵", "🅿️", "🚦",
      "🛣️", "🏖️", "🏨", "🧳", "🗺️", "🚀", "🚁", "⛵",
    ],
    keywords: {
      "🚗": "car transportation auto vehicle",
      "⛽": "gas fuel transportation",
      "✈️": "flight travel plane",
      "🏨": "hotel travel",
    },
  },
  {
    label: "Work & Tech",
    emojis: [
      "💼", "🧑‍💻", "💻", "🖥️", "📱", "⌨️", "🖱️", "📞", "📧", "📅", "📆", "🗂️",
      "📁", "📋", "✏️", "🖊️", "📌", "🔧", "🛠️", "⚙️",
    ],
    keywords: {
      "💼": "business work briefcase",
      "📱": "phone cashapp zelle venmo mobile",
      "💻": "computer software subscription",
      "📅": "calendar subscription recurring",
    },
  },
  {
    label: "Symbols & Status",
    emojis: [
      "✅", "❌", "⭐", "🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "⚫", "⚪", "❗",
      "❓", "⏳", "⌛", "⏰", "⏸️", "▶️", "⏭️", "🔁", "🔄", "🔔", "🔒", "🔓",
      "♻️", "🆓", "🆕", "💯", "🚩", "📤",
    ],
    keywords: {
      "✅": "paid done check complete settled",
      "❌": "declined no cancel",
      "⏳": "pending waiting",
      "⏰": "past due late overdue",
      "🔁": "autopay recurring transfer",
      "🆓": "free no balance zero",
    },
  },
  {
    label: "Faces & Fun",
    emojis: [
      "😀", "😎", "🤑", "🤔", "🤷", "🙌", "👍", "👎", "👀", "🎉", "🔥", "💪",
      "🧠", "❤️", "💔", "✨", "🌈", "☀️", "🌙", "⛈️",
    ],
    keywords: {
      "🤷": "optional shrug maybe",
      "🎉": "celebrate done",
    },
  },
];

// Flat list of all curated emoji (for "recent"/fallback needs).
export const ALL_EMOJI: string[] = Array.from(
  new Set(EMOJI_GROUPS.flatMap((g) => g.emojis)),
);
