/**
 * packs.mjs — POCKET PALS, Base Set.
 *
 * One creature-collector set, generated from a compact creature table rather
 * than hand-authored per card. Adding a creature is four lines; the builder
 * derives its colours from its energy type, assigns its collector number, and
 * emits every variant it qualifies for.
 *
 * ORIGINALITY: these are original creatures, original type names, original
 * frame art. The layout language of a creature card — HP in the corner, energy
 * costs beside attacks, a weakness/resistance footer, a collector number — is
 * genre grammar, the same way a sonnet has fourteen lines. What belongs to
 * somebody else is their names, their logos, their creatures and their frame
 * artwork, and none of that is here. Keep it that way: a booth that prints
 * knock-offs is a booth with a shelf life.
 */

import { ENERGY, ENERGY_IDS, energy } from './energy.mjs';
import { shade, alpha } from './draw.mjs';

/* ================================================================ rarity */

export const RARITIES = {
  common:    { id: 'common',    label: 'Common',      symbol: '●', weight: 58, foil: 'none',    color: '#8b93a1' },
  uncommon:  { id: 'uncommon',  label: 'Uncommon',    symbol: '◆', weight: 24, foil: 'satin',   color: '#7fc8a9' },
  rare:      { id: 'rare',      label: 'Rare',        symbol: '★', weight: 12, foil: 'holo',    color: '#f2c14e' },
  ultra:     { id: 'ultra',     label: 'Ultra Rare',  symbol: '✦', weight: 5,  foil: 'rainbow', color: '#c084fc' },
  secret:    { id: 'secret',    label: 'Secret Rare', symbol: '☆', weight: 1,  foil: 'gold',    color: '#ffd76e' },
};
export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'ultra', 'secret'];

/* ============================================================= creatures */

/**
 * One entry per creature. `evolvesTo` generates the Stage 1 card automatically,
 * inheriting the type and bumping HP and damage.
 */
const CREATURES = [
  {
    id: 'emberling', name: 'Emberling', type: 'ember', hp: 70, retreat: 1,
    flavor: 'Wags its tail near the ring light. Somehow always in focus.',
    attacks: [
      { cost: ['ember'], name: 'Warm Smile', dmg: 20, text: 'The photographer says “aww”.' },
      { cost: ['ember', 'plain'], name: 'Flash Blast', dmg: 50, text: 'Discard 1 blink from your bench.' },
    ],
    evolvesTo: {
      name: 'Blazepup', hp: 130, retreat: 2,
      ability: { name: 'Ring Light', text: 'Every Pal in this photo gets +10 HP while Blazepup is in frame.' },
      attacks: [
        { cost: ['ember', 'ember'], name: 'Sunflare Pose', dmg: 80, text: 'Your hair looks incredible. It just does.' },
        { cost: ['ember', 'ember', 'plain'], name: 'Golden Hour', dmg: 130, text: 'This attack cannot be blocked by bad lighting.' },
      ],
      flavor: 'It has never taken a bad photo. Not once. It is unbearable about this.',
    },
  },
  {
    id: 'splashling', name: 'Splashling', type: 'wave', hp: 60, retreat: 1,
    flavor: 'Fogs the lens on purpose and thinks it is hilarious.',
    attacks: [
      { cost: ['wave'], name: 'Splash Pose', dmg: 10, text: 'Flip a coin. If heads, look effortlessly cool.' },
      { cost: ['wave', 'wave'], name: 'Tidal Calm', dmg: 40, text: 'Heal 30 from every Pal in frame.' },
    ],
    evolvesTo: {
      name: 'Tidepaw', hp: 120, retreat: 2,
      attacks: [
        { cost: ['wave', 'plain'], name: 'Undertow', dmg: 60, text: 'The pose behind you is now Soaked.' },
        { cost: ['wave', 'wave', 'wave'], name: 'Deep Blue', dmg: 120, text: 'Everyone goes quiet for a second. Perfect shot.' },
      ],
      flavor: 'Calm on the surface. Absolutely feral about group photos.',
    },
  },
  {
    id: 'sproutle', name: 'Sproutle', type: 'leaf', hp: 70, retreat: 1,
    flavor: 'Grows a flower crown for anyone standing next to it.',
    attacks: [
      { cost: ['leaf'], name: 'Sprout', dmg: 20, text: 'Become slightly more photogenic.' },
      { cost: ['leaf', 'plain'], name: 'Bloom Burst', dmg: 50, text: 'Put a flower on every Pal in the photo.' },
    ],
    evolvesTo: {
      name: 'Bloomkin', hp: 130, retreat: 3,
      ability: { name: 'Soft Focus', text: 'Prevent all damage done to Bloomkin by unflattering angles.' },
      attacks: [
        { cost: ['leaf', 'leaf'], name: 'Petal Drift', dmg: 70, text: 'Fills the frame with petals. Costs nothing. Worth everything.' },
        { cost: ['leaf', 'leaf', 'plain'], name: 'Full Bloom', dmg: 120, text: 'Heal 50 from yourself. You have earned it.' },
      ],
      flavor: 'Slow to open up. Impossible to forget once it does.',
    },
  },
  {
    id: 'zaplet', name: 'Zaplet', type: 'volt', hp: 60, retreat: 1,
    flavor: 'Responsible for every photo where somebody is mid-blink.',
    attacks: [
      { cost: ['volt'], name: 'Static Hair', dmg: 20, text: 'Your hair is now part of the composition.' },
      { cost: ['volt', 'plain'], name: 'Shutter Snap', dmg: 50, text: 'Take the photo one beat early. On purpose.' },
    ],
    evolvesTo: {
      name: 'Voltmane', hp: 140, retreat: 2,
      attacks: [
        { cost: ['volt', 'volt'], name: 'Overcharge', dmg: 90, text: 'Discard 1 Volt energy. Everyone jumps.' },
        { cost: ['volt', 'volt', 'volt'], name: 'Megavolt Pose', dmg: 160, text: 'This attack does 20 damage to the shutter button.' },
      ],
      flavor: 'The countdown hits one and it is already airborne.',
    },
  },
  {
    id: 'chillbun', name: 'Chillbun', type: 'frost', hp: 80, retreat: 2,
    ability: { name: 'Cool Under Pressure', text: 'Chillbun cannot be affected by the countdown.' },
    flavor: 'Has one expression. It is the correct expression.',
    attacks: [
      { cost: ['frost'], name: 'Cool Stare', dmg: 30, text: 'The opposing pose is now Frozen.' },
      { cost: ['frost', 'frost'], name: 'Snowdrift', dmg: 70, text: 'Nobody moves for three seconds. Perfect.' },
    ],
  },
  {
    id: 'pebblit', name: 'Pebblit', type: 'stone', hp: 90, retreat: 3,
    flavor: 'Refuses to be cropped out. Physically refuses.',
    attacks: [
      { cost: ['stone'], name: 'Hold Still', dmg: 20, text: 'Pebblit does not move. Pebblit has never moved.' },
      { cost: ['stone', 'plain'], name: 'Rock Solid', dmg: 50, text: 'Reduce all shake damage by 30.' },
    ],
    evolvesTo: {
      name: 'Boulderox', hp: 160, retreat: 4,
      ability: { name: 'Immovable', text: 'Boulderox cannot be moved to the back row of a group photo.' },
      attacks: [
        { cost: ['stone', 'stone'], name: 'Landslide', dmg: 80, text: 'Everyone leans. The whole frame tilts.' },
        { cost: ['stone', 'stone', 'plain'], name: 'Monument', dmg: 130, text: 'This photo will be on a fridge for eleven years.' },
      ],
      flavor: 'Centre of every group shot since the day it hatched.',
    },
  },
  {
    id: 'gustwing', name: 'Gustwing', type: 'gale', hp: 70, retreat: 1,
    flavor: 'Provides the hair movement. Charges nothing. A professional.',
    attacks: [
      { cost: ['gale'], name: 'Updraft', dmg: 20, text: 'Your hair does the thing it does in movies.' },
      { cost: ['gale', 'plain'], name: 'Slipstream', dmg: 60, text: 'Switch places with a Pal on your bench.' },
    ],
  },
  {
    id: 'duskwisp', name: 'Duskwisp', type: 'shade', hp: 70, retreat: 0,
    ability: { name: 'Half There', text: 'Duskwisp only appears in every other photo. Nobody knows why.' },
    flavor: 'Shows up in the background of shots taken before it existed.',
    attacks: [
      { cost: ['shade'], name: 'Peekaboo', dmg: 30, text: 'Appear behind someone. They did not consent to this.' },
      { cost: ['shade', 'plain'], name: 'Long Exposure', dmg: 70, text: 'Leaves a streak across the frame. Deliberate. Probably.' },
    ],
  },
  {
    id: 'glimmerpuff', name: 'Glimmerpuff', type: 'radiant', hp: 80, retreat: 1,
    ability: { name: 'Sparkle Field', text: 'While Glimmerpuff is in frame, every card printed this session gains a sparkle.' },
    flavor: 'Made entirely of the good part of a birthday.',
    attacks: [
      { cost: ['radiant'], name: 'Twinkle', dmg: 20, text: 'Everything in frame gets 8% cuter.' },
      { cost: ['radiant', 'radiant'], name: 'Starburst', dmg: 80, text: 'Heal 40 from every Pal you have ever printed.' },
    ],
  },
  {
    id: 'bubblox', name: 'Bubblox', type: 'toxin', hp: 80, retreat: 2,
    flavor: 'Its bubbles smell faintly of grape soda. This is not reassuring.',
    attacks: [
      { cost: ['toxin'], name: 'Fizz', dmg: 20, text: 'The opposing pose is now Sticky.' },
      { cost: ['toxin', 'plain'], name: 'Bubble Trap', dmg: 60, text: 'Nobody can leave the booth until the strip prints.' },
    ],
  },
  {
    id: 'cogsnap', name: 'Cogsnap', type: 'steel', hp: 100, retreat: 3,
    ability: { name: 'Autofocus', text: 'Cogsnap is never blurry. Cogsnap does not permit blur.' },
    flavor: 'Ticks quietly during the countdown. Always on the beat.',
    attacks: [
      { cost: ['steel'], name: 'Lock On', dmg: 30, text: 'This attack cannot miss.' },
      { cost: ['steel', 'plain'], name: 'Shutter Slam', dmg: 70, text: 'Discard the blurry one. There is always a blurry one.' },
    ],
  },
  {
    id: 'mindmoth', name: 'Mindmoth', type: 'psy', hp: 70, retreat: 1,
    flavor: 'Already knows which shot you are going to pick.',
    attacks: [
      { cost: ['psy'], name: 'Read the Room', dmg: 20, text: 'Choose the pose everyone was about to do anyway.' },
      { cost: ['psy', 'psy'], name: 'Déjà Vu', dmg: 80, text: 'Take this photo again. It was better the first time.' },
    ],
  },
  {
    id: 'dracolet', name: 'Dracolet', type: 'wyrm', hp: 90, retreat: 2,
    flavor: 'Too big for the booth. Gets in anyway.',
    attacks: [
      { cost: ['wyrm'], name: 'Tiny Roar', dmg: 30, text: 'Startles exactly one person in the group.' },
      { cost: ['wyrm', 'plain'], name: 'Wingspan', dmg: 60, text: 'Takes up the whole frame. Unapologetic.' },
    ],
    evolvesTo: {
      name: 'Wyrmarch', hp: 170, retreat: 3,
      ability: { name: 'Hoard', text: 'Wyrmarch keeps one copy of every card printed at this booth.' },
      attacks: [
        { cost: ['wyrm', 'wyrm'], name: 'Gold Rush', dmg: 100, text: 'Draw one Secret Rare. You will not get it. But you drew it.' },
        { cost: ['wyrm', 'wyrm', 'plain'], name: 'Apex Pose', dmg: 180, text: 'The strip prints in silence. Everyone knows.' },
      ],
      flavor: 'Sleeps on a pile of photo strips. Will not explain how it got them.',
    },
  },
  {
    id: 'fluffkin', name: 'Fluffkin', type: 'plain', hp: 60, retreat: 1,
    flavor: 'The first Pal anybody pulls. Nobody trades it away.',
    attacks: [
      { cost: ['plain'], name: 'Tag Along', dmg: 10, text: 'Squeeze into the shot at the last second.' },
      { cost: ['plain', 'plain'], name: 'Group Hug', dmg: 40, text: 'Heal 20 from every Pal in frame. Including the ones sulking.' },
    ],
  },
];

/* -------------------------------------------------------- chase variants */

const MAX_CARDS   = ['blazepup', 'tidepaw', 'voltmane', 'wyrmarch', 'glimmerpuff'];
const FULL_ART    = ['chillbun', 'duskwisp', 'mindmoth', 'bloomkin'];
const RAINBOW     = ['blazepup', 'wyrmarch', 'glimmerpuff'];
const SHINY       = ['emberling', 'sproutle', 'zaplet', 'fluffkin'];

/** Shiny recolours a Pal onto a neighbouring type's palette and stars it. */
const SHINY_PALETTE = { emberling: 'psy', sproutle: 'frost', zaplet: 'radiant', fluffkin: 'wyrm' };

/* ---------------------------------------------------------- limited drops */

const PROMOS = [
  {
    id: 'boothra', name: 'Boothra', type: 'radiant', hp: 110, retreat: 1,
    artist: 'guest artist',
    character: { file: 'characters/boothra.png', anchor: 'bottom-right', scale: 0.42 },
    availability: { start: '2026-08-24', end: '2026-09-07', mintLimit: 500 },
    rarityFloor: 'rare',
    ability: { name: 'Four Flash Salute', text: 'Boothra appears in all four shots of the strip, whether or not you invited it.' },
    flavor: 'Lives in the booth. Predates the booth. Do not ask the booth about it.',
    attacks: [
      { cost: ['radiant'], name: 'Say Cheese', dmg: 30, text: 'Everyone in frame smiles. It is not optional.' },
      { cost: ['radiant', 'plain'], name: 'Curtain Call', dmg: 90, text: 'The strip prints warm. It always prints warm.' },
    ],
  },
  {
    id: 'hallowisp', name: 'Hallowisp', type: 'shade', hp: 120, retreat: 0,
    artist: 'guest artist',
    character: { file: 'characters/hallowisp.png', anchor: 'bottom-left', scale: 0.44 },
    availability: { start: '2026-10-01', end: '2026-11-01', mintLimit: 666 },
    rarityFloor: 'ultra',
    ability: { name: 'Third Wheel', text: 'Hallowisp is standing behind you in every photo taken in October.' },
    flavor: 'It was not there when you posed. It is there now.',
    attacks: [
      { cost: ['shade'], name: 'Boo Drop', dmg: 40, text: 'The countdown skips a number.' },
      { cost: ['shade', 'shade'], name: 'Midnight Set', dmg: 110, text: 'All lights in the booth dim by one stop.' },
    ],
  },
];

/* ============================================================== party */

/**
 * Personalised party cards. These are not part of the collectible set — they
 * are the birthday / graduation / baby-shower format, where the customer types
 * a name and an age and the card is about them.
 *
 * Six colourways so a party can match its own theme; the energy type still
 * drives every colour, so nothing here is a special case downstream.
 */
const PARTY_THEMES = [
  { key: 'sunburst',   name: 'Sunburst',   type: 'ember' },
  { key: 'bubblegum',  name: 'Bubblegum',  type: 'radiant' },
  { key: 'sparkler',   name: 'Sparkler',   type: 'volt' },
  { key: 'meadow',     name: 'Meadow',     type: 'leaf' },
  { key: 'lagoon',     name: 'Lagoon',     type: 'wave' },
  { key: 'twilight',   name: 'Twilight',   type: 'psy' },
];

/* =============================================================== cutie */

/**
 * The soft/cute style — pastel stock, scalloped sticker edge, a mascot peeking
 * out from behind the photo. Its own visual world, not a variant of the
 * creature cards, and it takes personalisation the same way party cards do.
 */
const CUTIE_THEMES = [
  { key: 'strawberry', name: 'Strawberry Milk', type: 'radiant',
    chips: [['mood', 'sweet'], ['snack', 'berry'], ['friends', 'MAX']], caption: 'today was a good day' },
  { key: 'sodapop',    name: 'Soda Pop',        type: 'frost',
    chips: [['mood', 'fizzy'], ['snack', 'ice'], ['friends', '99']], caption: 'one more scoop, please' },
  { key: 'matcha',     name: 'Matcha Cloud',    type: 'leaf',
    chips: [['mood', 'breezy'], ['snack', 'mochi'], ['friends', 'BFF']], caption: 'floaty little feeling' },
  { key: 'butter',     name: 'Butter Cake',     type: 'volt',
    chips: [['mood', 'sunny'], ['snack', 'cake'], ['friends', '∞']], caption: 'save me the corner piece' },
  { key: 'ube',        name: 'Ube Dream',       type: 'psy',
    chips: [['mood', 'sleepy'], ['snack', 'taro'], ['friends', 'MAX']], caption: 'five more minutes' },
  { key: 'cinnamon',   name: 'Cinnamon Bun',    type: 'plain',
    chips: [['mood', 'cosy'], ['snack', 'bread'], ['friends', 'BFF']], caption: 'warm from the oven' },
];

/* =============================================================== strips */

/**
 * Classic photo strips, offered alongside the cards. 2:6, four frames, the
 * customer's chosen name across the top. Themes rather than card frames,
 * because a strip has no stat block to colour.
 */
const STRIP_THEMES = [
  { key: 'classic',  name: 'Classic',  type: 'plain',   dark: true,  confetti: false, header: 'PHOTO BOOTH' },
  { key: 'midnight', name: 'Midnight', type: 'psy',     dark: true,  confetti: true,  header: 'TONIGHT' },
  { key: 'sunset',   name: 'Sunset',   type: 'ember',   dark: true,  confetti: false, header: 'GOLDEN HOUR' },
  { key: 'blush',    name: 'Blush',    type: 'radiant', dark: false, confetti: true,  header: 'SWEET' },
  { key: 'mint',     name: 'Mint',     type: 'leaf',    dark: false, confetti: false, header: 'FRESH' },
  { key: 'cream',    name: 'Cream',    type: 'volt',    dark: false, confetti: true,  header: 'SUNNY' },
];

/* =============================================================== builder */

/** Every visual property of a card comes from its energy type. */
function themeFor(typeId, variant) {
  const e = energy(typeId);
  const dark = variant === 'fullart' || variant === 'rainbow';
  return {
    type: typeId,
    border: e.base,
    borderEdge: e.light,
    borderDark: e.dark,
    accent: e.dark,
    plate: shade(e.light, 0.18),
    plateText: e.ink,
    textbox: dark ? 'rgba(12,14,20,.74)' : '#fffdf8',
    textboxText: dark ? '#f2f5fb' : e.ink,
    glow: e.light,
    pip: e.base,
    fontDisplay: 'Nunito, "Trebuchet MS", Verdana, sans-serif',
    fontBody: 'Nunito, Verdana, sans-serif',
  };
}

let SEQ = 0;
const FRAMES = [];

function push(frame) {
  FRAMES.push(frame);
  return frame;
}

function makeCard({
  key, name, typeId, stage, evolvesFrom, hp, retreat, attacks, ability, flavor,
  variant = 'standard', rarityFloor = null, extra = {},
}) {
  const e = energy(typeId);
  const paletteType = variant === 'shiny' ? (SHINY_PALETTE[key] || typeId) : typeId;
  return {
    id: variant === 'standard' ? `pp-${key}` : `pp-${key}-${variant}`,
    name: variant === 'max' ? `${name} MAX` : name,
    baseName: name,
    variant,
    energyType: typeId,
    stage,
    evolvesFrom: evolvesFrom || null,
    hp: variant === 'max' ? Math.round(hp * 1.9 / 10) * 10 : hp,
    stock: variant === 'max' ? 'silver' : 'gold',
    template: variant === 'max' ? 'creatureMax'
      : (variant === 'fullart' || variant === 'rainbow') ? 'creatureFullArt'
      : 'creature',
    theme: themeFor(paletteType, variant),
    rarityFloor,
    content: {
      ability: ability || null,
      attacks: (attacks || []).map(a => variant === 'max'
        ? { ...a, dmg: Math.round(a.dmg * 1.6 / 10) * 10 }
        : a),
      flavor,
      footer: {
        weakness: e.weak, weaknessText: '×2',
        resistance: e.resist, resistanceText: '−30',
        retreat: variant === 'max' ? retreat + 1 : retreat,
      },
      maxRule: variant === 'max'
        ? 'When your MAX Pal is knocked out, your opponent keeps two of your photos.'
        : null,
      shiny: variant === 'shiny',
    },
    ...extra,
  };
}

/* --- basics + evolutions ------------------------------------------------ */

const byName = {};

for (const c of CREATURES) {
  const basic = makeCard({
    key: c.id, name: c.name, typeId: c.type, stage: 'Basic',
    hp: c.hp, retreat: c.retreat, attacks: c.attacks, ability: c.ability, flavor: c.flavor,
    rarityFloor: c.ability ? 'uncommon' : null,
    extra: { packId: 'basics', evolvesTo: c.evolvesTo?.name || null },
  });
  byName[c.id] = basic;
  push(basic);

  if (c.evolvesTo) {
    const ev = c.evolvesTo;
    const key = ev.name.toLowerCase();
    const card = makeCard({
      key, name: ev.name, typeId: c.type, stage: 'Stage 1', evolvesFrom: c.name,
      hp: ev.hp, retreat: ev.retreat, attacks: ev.attacks, ability: ev.ability, flavor: ev.flavor,
      rarityFloor: 'rare',
      extra: { packId: 'evolved' },
    });
    byName[key] = card;
    push(card);
  }
}

/* --- chase variants ----------------------------------------------------- */

const source = key => {
  const base = FRAMES.find(f => f.variant === 'standard' && f.id === `pp-${key}`);
  if (!base) throw new Error(`No base card for variant: ${key}`);
  const crea = CREATURES.find(c => c.id === key);
  const evo = CREATURES.map(c => c.evolvesTo).find(e => e && e.name.toLowerCase() === key);
  return { base, def: crea || evo, key };
};

for (const key of MAX_CARDS) {
  const { base, def } = source(key);
  push(makeCard({
    key, name: base.baseName, typeId: base.energyType, stage: 'MAX',
    evolvesFrom: base.evolvesFrom, hp: base.hp,
    retreat: base.content.footer.retreat, attacks: def.attacks,
    ability: def.ability, flavor: def.flavor,
    variant: 'max', rarityFloor: 'ultra',
    extra: { packId: 'max' },
  }));
}

for (const key of FULL_ART) {
  const { base, def } = source(key);
  push(makeCard({
    key, name: base.baseName, typeId: base.energyType, stage: base.stage,
    evolvesFrom: base.evolvesFrom, hp: base.hp,
    retreat: base.content.footer.retreat, attacks: def.attacks,
    ability: def.ability, flavor: def.flavor,
    variant: 'fullart', rarityFloor: 'ultra',
    extra: { packId: 'fullart' },
  }));
}

for (const key of SHINY) {
  const { base, def } = source(key);
  push(makeCard({
    key, name: base.baseName, typeId: base.energyType, stage: base.stage,
    evolvesFrom: base.evolvesFrom, hp: base.hp,
    retreat: base.content.footer.retreat, attacks: def.attacks,
    ability: def.ability, flavor: def.flavor,
    variant: 'shiny', rarityFloor: 'rare',
    extra: { packId: 'shiny' },
  }));
}

/* Secret rares are numbered ABOVE the set size — the genre's oldest tell that
   you pulled something that isn't supposed to be in the set. */
const SET_SIZE = FRAMES.length;   // fixed before party cards and secrets are added

for (const key of RAINBOW) {
  const { base, def } = source(key);
  push(makeCard({
    key, name: base.baseName, typeId: base.energyType, stage: base.stage,
    evolvesFrom: base.evolvesFrom, hp: base.hp,
    retreat: base.content.footer.retreat, attacks: def.attacks,
    ability: def.ability, flavor: def.flavor,
    variant: 'rainbow', rarityFloor: 'secret',
    extra: { packId: 'secret', secret: true },
  }));
}

for (const p of PROMOS) {
  push(makeCard({
    key: p.id, name: p.name, typeId: p.type, stage: 'Promo',
    hp: p.hp, retreat: p.retreat, attacks: p.attacks, ability: p.ability, flavor: p.flavor,
    variant: 'fullart', rarityFloor: p.rarityFloor,
    extra: {
      packId: 'promo', promo: true, artist: p.artist,
      character: p.character, availability: p.availability,
    },
  }));
}

/* --- party cards ---------------------------------------------------- */

PARTY_THEMES.forEach((pt, i) => {
  const e = energy(pt.type);
  push({
    id: `party-${pt.key}`,
    name: pt.name,
    baseName: pt.name,
    variant: 'party',
    party: true,
    packId: 'party',
    energyType: pt.type,
    stage: 'Party',
    evolvesFrom: null,
    hp: 100,
    stock: 'gold',
    template: 'party',
    theme: themeFor(pt.type, 'party'),
    rarityFloor: 'rare',
    partyNumber: i + 1,
    content: {
      ability: null,
      attacks: [
        { cost: [pt.type, 'plain'], name: 'Birthday Blast', dmg: '90+',
          text: 'If it is {{name}}\u2019s birthday, this attack does 90 more damage.' },
        { cost: [pt.type, pt.type, 'plain'], name: 'Present Barrage', dmg: 100,
          text: 'Discard 2 Energy attached to {{name}} to unwrap everything at once.' },
      ],
      flavor: null,
      footer: {
        weakness: e.weak, weaknessText: '×2',
        resistance: e.resist, resistanceText: '−30',
        retreat: 1,
      },
      maxRule: null,
      shiny: false,
    },
  });
});

/* --- cutie cards ----------------------------------------------------- */

CUTIE_THEMES.forEach((ct, i) => {
  push({
    id: `cutie-${ct.key}`,
    name: ct.name,
    baseName: ct.name,
    variant: 'cutie',
    cutie: true,
    packId: 'cutie',
    energyType: ct.type,
    stage: 'Cutie',
    evolvesFrom: null,
    hp: 80,
    stock: 'gold',
    template: 'kawaii',
    theme: themeFor(ct.type, 'cutie'),
    rarityFloor: 'uncommon',
    cutieNumber: i + 1,
    content: {
      ability: null,
      attacks: [],
      chips: ct.chips,
      caption: ct.caption,
      flavor: null,
      footer: {},
      maxRule: null,
      shiny: false,
    },
  });
});

/* --- photo strips ---------------------------------------------------- */

STRIP_THEMES.forEach((st, i) => {
  push({
    id: `strip-${st.key}`,
    name: st.name,
    baseName: st.name,
    variant: 'strip',
    strip: true,
    packId: 'strips',
    energyType: st.type,
    stage: 'Strip',
    evolvesFrom: null,
    hp: 0,
    stock: 'none',
    template: 'strip',
    aspect: [2, 6],
    theme: themeFor(st.type, 'strip'),
    rarityFloor: 'common',
    stripNumber: i + 1,
    content: {
      ability: null,
      attacks: [],
      cells: 4,
      dark: st.dark,
      confetti: st.confetti,
      header: st.header,
      flavor: null,
      footer: {},
      maxRule: null,
      shiny: false,
    },
  });
});

/* Collector numbers, assigned in set order. */
FRAMES.forEach((f, i) => {
  f.setNumber = i + 1;
  f.setSize = SET_SIZE;
  if (f.party) f.collectorNumber = `PARTY ${String(f.partyNumber).padStart(2, '0')}`;
  else if (f.cutie) f.collectorNumber = `CUTIE ${String(f.cutieNumber).padStart(2, '0')}`;
  else if (f.strip) f.collectorNumber = `STRIP ${String(f.stripNumber).padStart(2, '0')}`;
  else if (f.promo) f.collectorNumber = `PR${String(PROMOS.findIndex(p => f.id.includes(p.id)) + 1).padStart(2, '0')}`;
  else f.collectorNumber = `${String(i + 1).padStart(3, '0')}/${String(SET_SIZE).padStart(3, '0')}`;
});

/* ================================================================= packs */

const PACK_META = [
  { id: 'party',   name: 'Party Cards',    tagline: 'Put their name and age on it — birthdays, graduations, showers', order: 1 },
  { id: 'cutie',   name: 'Cutie Club',     tagline: 'Pastel, scalloped and soft — with a buddy peeking out', order: 2 },
  { id: 'strips',  name: 'Photo Strips',   tagline: 'The classic four-frame strip, themed and stickerable', order: 3 },
  { id: 'promo',   name: 'Limited Promos', tagline: 'Hand-drawn guests. Here for a fortnight, then gone.', order: 5,  limited: true },
  { id: 'basics',  name: 'Basics',         tagline: 'One Pal for every energy type — where a collection starts', order: 10 },
  { id: 'evolved', name: 'Evolved',        tagline: 'Stage 1 Pals with abilities and a bigger HP bar',          order: 20 },
  { id: 'max',     name: 'MAX Cards',      tagline: 'Oversized HP, silver frame, damage that ends the game',    order: 30 },
  { id: 'fullart', name: 'Full Art',       tagline: 'Your photo, edge to edge, text floating on top',           order: 40 },
  { id: 'shiny',   name: 'Shiny',          tagline: 'Same Pal, wrong colours — the collector’s tell',      order: 50 },
  { id: 'secret',  name: 'Secret Rare',    tagline: 'Rainbow foil, numbered past the end of the set',           order: 60 },
];

export const SET = {
  id: 'PP-BASE',
  name: 'Pocket Pals — Base Set',
  size: SET_SIZE,
  total: FRAMES.length,
  types: ENERGY_IDS.length,
};

export const PACKS = PACK_META.map(m => ({
  ...m,
  template: 'creature',
  frames: FRAMES.filter(f => f.packId === m.id),
})).filter(p => p.frames.length);

/* ------------------------------------------------------------- helpers */

export function allFrames() {
  return PACKS.flatMap(p =>
    p.frames.map(f => ({
      ...f,
      packName: p.name,
      limited: !!p.limited,
    }))
  );
}

/** [width, height] in inches. Strips are 2x6; everything else is a 2.5x3.5 card. */
export function frameAspect(frame) {
  const a = frame?.aspect || [2.5, 3.5];
  return { w: a[0], h: a[1], ratio: a[0] / a[1] };
}

/** Pixel box for a frame at a target width. */
export function frameBox(frame, width) {
  const { ratio } = frameAspect(frame);
  return { W: Math.round(width), H: Math.round(width / ratio) };
}

export function frameById(id) {
  return allFrames().find(f => f.id === id) || null;
}

/** A frame is live if it has no availability window, or now falls inside it. */
export function isAvailable(frame, now = new Date()) {
  const a = frame.availability;
  if (!a) return true;
  const s = a.start ? new Date(a.start + 'T00:00:00') : null;
  const e = a.end ? new Date(a.end + 'T23:59:59') : null;
  if (s && now < s) return false;
  if (e && now > e) return false;
  return true;
}

export function availableFrames(now = new Date()) {
  return allFrames().filter(f => isAvailable(f, now));
}

/** Frames grouped into the tabs the picker screen shows. */
export function pickerGroups(now = new Date()) {
  const live = availableFrames(now);
  return PACKS
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(p => ({
      id: p.id, name: p.name, tagline: p.tagline, limited: !!p.limited,
      frames: live.filter(f => f.packId === p.id),
    }))
    .filter(g => g.frames.length);
}

export { ENERGY, ENERGY_IDS, energy };
