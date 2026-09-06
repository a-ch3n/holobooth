/**
 * packs.mjs — POCKET CREATURES, Base Set.
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

/** One entry per creature. */
const CREATURES = [
  {
    id: 'emberling', name: 'Emberling', type: 'ember', hp: 70, retreat: 1,
    flavor: 'Its fur radiates a gentle heat that glows brighter whenever a camera points its way.',
    attacks: [
      { cost: ['ember'], name: 'Warm Smile', dmg: 20, text: 'The photographer says “aww”.' },
      { cost: ['ember', 'plain'], name: 'Flash Blast', dmg: 50, text: 'Discard 1 blink from your bench.' },
    ],
  },
  {
    id: 'splashling', name: 'Splashling', type: 'wave', hp: 60, retreat: 1,
    flavor: 'It keeps a thin film of water across its skin and mists the air whenever it gets excited.',
    attacks: [
      { cost: ['wave'], name: 'Splash Pose', dmg: 10, text: 'Flip a coin. If heads, look effortlessly cool.' },
      { cost: ['wave', 'wave'], name: 'Tidal Calm', dmg: 40, text: 'Heal 30 from every Creature in frame.' },
    ],
  },
  {
    id: 'sproutle', name: 'Sproutle', type: 'leaf', hp: 70, retreat: 1,
    flavor: 'It grows a fresh bud every morning, and flowers quietly bloom on anyone who stays close.',
    attacks: [
      { cost: ['leaf'], name: 'Sprout', dmg: 20, text: 'Become slightly more photogenic.' },
      { cost: ['leaf', 'plain'], name: 'Bloom Burst', dmg: 50, text: 'Put a flower on every Creature in the photo.' },
    ],
  },
  {
    id: 'zaplet', name: 'Zaplet', type: 'volt', hp: 60, retreat: 1,
    flavor: 'It builds up static with every step. A small spark jumps between its ears whenever a flash is about to fire.',
    attacks: [
      { cost: ['volt'], name: 'Static Hair', dmg: 20, text: 'Your hair is now part of the composition.' },
      { cost: ['volt', 'plain'], name: 'Shutter Snap', dmg: 50, text: 'Take the photo one beat early. On purpose.' },
    ],
  },
  {
    id: 'chillbun', name: 'Chillbun', type: 'frost', hp: 80, retreat: 2,
    ability: { name: 'Cool Under Pressure', text: 'Chillbun cannot be affected by the countdown.' },
    flavor: 'Its body temperature never rises, and its expression has not changed since the day it hatched.',
    attacks: [
      { cost: ['frost'], name: 'Cool Stare', dmg: 30, text: 'The opposing pose is now Frozen.' },
      { cost: ['frost', 'frost'], name: 'Snowdrift', dmg: 70, text: 'Nobody moves for three seconds. Perfect.' },
    ],
  },
  {
    id: 'pebblit', name: 'Pebblit', type: 'stone', hp: 90, retreat: 3,
    flavor: 'Built like a boulder with legs. Nothing short of an earthquake moves it once a photo starts.',
    attacks: [
      { cost: ['stone'], name: 'Hold Still', dmg: 20, text: 'Pebblit does not move. Pebblit has never moved.' },
      { cost: ['stone', 'plain'], name: 'Rock Solid', dmg: 50, text: 'Reduce all shake damage by 30.' },
    ],
  },
  {
    id: 'gustwing', name: 'Gustwing', type: 'gale', hp: 70, retreat: 1,
    flavor: 'It rides air currents most creatures cannot feel, circling just out of frame until the last second.',
    attacks: [
      { cost: ['gale'], name: 'Updraft', dmg: 20, text: 'Your hair does the thing it does in movies.' },
      { cost: ['gale', 'plain'], name: 'Slipstream', dmg: 60, text: 'Switch places with a Creature on your bench.' },
    ],
  },
  {
    id: 'duskwisp', name: 'Duskwisp', type: 'shade', hp: 70, retreat: 0,
    ability: { name: 'Half There', text: 'Duskwisp only appears in every other photo. Nobody knows why.' },
    flavor: 'It exists in only half of every photo it appears in. Nobody has ever agreed on which half.',
    attacks: [
      { cost: ['shade'], name: 'Peekaboo', dmg: 30, text: 'Appear behind someone. They did not consent to this.' },
      { cost: ['shade', 'plain'], name: 'Long Exposure', dmg: 70, text: 'Leaves a streak across the frame. Deliberate. Probably.' },
    ],
  },
  {
    id: 'glimmerpuff', name: 'Glimmerpuff', type: 'radiant', hp: 80, retreat: 1,
    ability: { name: 'Sparkle Field', text: 'While Glimmerpuff is in frame, every card printed this session gains a sparkle.' },
    flavor: 'Made of concentrated warmth. Its Sparkle Field grows strongest at parties.',
    attacks: [
      { cost: ['radiant'], name: 'Twinkle', dmg: 20, text: 'Everything in frame gets 8% cuter.' },
      { cost: ['radiant', 'radiant'], name: 'Starburst', dmg: 80, text: 'Heal 40 from every Creature you have ever printed.' },
    ],
  },
  {
    id: 'bubblox', name: 'Bubblox', type: 'toxin', hp: 80, retreat: 2,
    flavor: 'It blows bubbles laced with a mild, grape-scented toxin. Harmless to people, mostly.',
    attacks: [
      { cost: ['toxin'], name: 'Fizz', dmg: 20, text: 'The opposing pose is now Sticky.' },
      { cost: ['toxin', 'plain'], name: 'Bubble Trap', dmg: 60, text: 'Nobody can leave the booth until the strip prints.' },
    ],
  },
  {
    id: 'cogsnap', name: 'Cogsnap', type: 'steel', hp: 100, retreat: 3,
    ability: { name: 'Autofocus', text: 'Cogsnap is never blurry. Cogsnap does not permit blur.' },
    flavor: 'It has a lens for an eye and gears for a heart, and has never once produced a blurry photo.',
    attacks: [
      { cost: ['steel'], name: 'Lock On', dmg: 30, text: 'This attack cannot miss.' },
      { cost: ['steel', 'plain'], name: 'Shutter Slam', dmg: 70, text: 'Discard the blurry one. There is always a blurry one.' },
    ],
  },
  {
    id: 'mindmoth', name: 'Mindmoth', type: 'psy', hp: 70, retreat: 1,
    flavor: 'It senses a pose before it happens, striking the exact expression everyone wanted first.',
    attacks: [
      { cost: ['psy'], name: 'Read the Room', dmg: 20, text: 'Choose the pose everyone was about to do anyway.' },
      { cost: ['psy', 'psy'], name: 'Déjà Vu', dmg: 80, text: 'Take this photo again. It was better the first time.' },
    ],
  },
  {
    id: 'dracolet', name: 'Dracolet', type: 'wyrm', hp: 90, retreat: 2,
    flavor: 'Far too large for any booth it climbs into. It has never once fit inside a single frame.',
    attacks: [
      { cost: ['wyrm'], name: 'Tiny Roar', dmg: 30, text: 'Startles exactly one person in the group.' },
      { cost: ['wyrm', 'plain'], name: 'Wingspan', dmg: 60, text: 'Takes up the whole frame. Unapologetic.' },
    ],
  },
  {
    id: 'fluffkin', name: 'Fluffkin', type: 'plain', hp: 60, retreat: 1,
    flavor: 'Has no special powers, only an unmatched talent for squeezing into group photos at the last second.',
    attacks: [
      { cost: ['plain'], name: 'Tag Along', dmg: 10, text: 'Squeeze into the shot at the last second.' },
      { cost: ['plain', 'plain'], name: 'Group Hug', dmg: 40, text: 'Heal 20 from every Creature in frame. Including the ones sulking.' },
    ],
  },
];

/* -------------------------------------------------------- chase variants */

const MAX_CARDS   = ['emberling', 'splashling', 'zaplet', 'dracolet', 'glimmerpuff'];
const FULL_ART    = ['chillbun', 'duskwisp', 'mindmoth', 'sproutle'];
const RAINBOW     = ['emberling', 'dracolet', 'glimmerpuff'];

/* ---------------------------------------------------------- limited drops */

const PROMOS = [
  {
    id: 'boothra', name: 'Boothra', type: 'radiant', hp: 110, retreat: 1,
    artist: 'guest artist',
    character: { file: 'characters/boothra.png', anchor: 'bottom-right', scale: 0.42 },
    availability: { start: '2026-08-24', end: '2026-09-07', mintLimit: 500 },
    rarityFloor: 'rare',
    ability: { name: 'Four Flash Salute', text: 'Boothra appears in all four shots of the strip, whether or not you invited it.' },
    flavor: 'Has lived in the booth longer than anyone can remember. Appears in every shot on the strip, invited or not.',
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
    flavor: 'Only appears once the shutter has already closed. By the time you notice it, the moment is long gone.',
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
  key, name, typeId, stage, hp, retreat, attacks, ability, flavor,
  variant = 'standard', rarityFloor = null, extra = {},
}) {
  const e = energy(typeId);
  return {
    id: variant === 'standard' ? `pp-${key}` : `pp-${key}-${variant}`,
    name: variant === 'max' ? `${name} MAX` : name,
    baseName: name,
    variant,
    energyType: typeId,
    stage,
    hp: variant === 'max' ? Math.round(hp * 1.9 / 10) * 10 : hp,
    stock: variant === 'max' ? 'silver' : 'gold',
    template: variant === 'max' ? 'creatureMax'
      : (variant === 'fullart' || variant === 'rainbow') ? 'creatureFullArt'
      : 'creature',
    theme: themeFor(typeId, variant),
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
        ? 'When your MAX Creature is knocked out, your opponent keeps two of your photos.'
        : null,
    },
    ...extra,
  };
}

/* --- basics -------------------------------------------------------------- */

const byName = {};

/** The Pokédex-style header every entry opens with — "NAME, the Type
 *  Creature." — built from the card's own name/type rather than typed
 *  per-entry, so a renamed or retyped creature can never leave a stale
 *  header behind. */
function pokedexEntry(name, typeId, body) {
  return `${name.toUpperCase()}, the ${energy(typeId).name} Creature. ${body}`;
}

for (const c of CREATURES) {
  const basic = makeCard({
    key: c.id, name: c.name, typeId: c.type, stage: 'Basic',
    hp: c.hp, retreat: c.retreat, attacks: c.attacks, ability: c.ability,
    flavor: pokedexEntry(c.name, c.type, c.flavor),
    rarityFloor: c.ability ? 'uncommon' : null,
    extra: { packId: 'basics' },
  });
  byName[c.id] = basic;
  push(basic);
}

/* --- chase variants ----------------------------------------------------- */

const source = key => {
  const base = FRAMES.find(f => f.variant === 'standard' && f.id === `pp-${key}`);
  if (!base) throw new Error(`No base card for variant: ${key}`);
  const def = CREATURES.find(c => c.id === key);
  return { base, def, key };
};

/**
 * MAX and Secret Rare prints don't just reuse the basic's Pokédex entry
 * verbatim — a short line gets appended describing the same trait at
 * whatever scale that variant implies, so a chase card's own record never
 * reads as a copy-paste of the card it was pulled from (only Basics print
 * this text on the card face today, but every variant still carries its own
 * accurate entry). Full Art keeps the original entry untouched, the way an
 * alternate-art print in a real set usually does.
 */
function variantFlavor(baseFlavor, variant) {
  if (variant === 'max') return `${baseFlavor} This MAX-sized print makes it impossible to miss.`;
  if (variant === 'rainbow') return `${baseFlavor} This rainbow-foil print is rare enough that most collectors only ever see one.`;
  return baseFlavor;
}

for (const key of MAX_CARDS) {
  const { base, def } = source(key);
  push(makeCard({
    key, name: base.baseName, typeId: base.energyType, stage: 'MAX',
    hp: base.hp,
    retreat: base.content.footer.retreat, attacks: def.attacks,
    ability: def.ability, flavor: pokedexEntry(base.baseName, base.energyType, variantFlavor(def.flavor, 'max')),
    variant: 'max', rarityFloor: 'ultra',
    extra: { packId: 'max' },
  }));
}

for (const key of FULL_ART) {
  const { base, def } = source(key);
  push(makeCard({
    key, name: base.baseName, typeId: base.energyType, stage: base.stage,
    hp: base.hp,
    retreat: base.content.footer.retreat, attacks: def.attacks,
    ability: def.ability, flavor: pokedexEntry(base.baseName, base.energyType, def.flavor),
    variant: 'fullart', rarityFloor: 'ultra',
    extra: { packId: 'fullart' },
  }));
}

/* Secret rares are numbered ABOVE the set size — the genre's oldest tell that
   you pulled something that isn't supposed to be in the set. */
const SET_SIZE = FRAMES.length;   // fixed before party cards and secrets are added

for (const key of RAINBOW) {
  const { base, def } = source(key);
  push(makeCard({
    key, name: base.baseName, typeId: base.energyType, stage: base.stage,
    hp: base.hp,
    retreat: base.content.footer.retreat, attacks: def.attacks,
    ability: def.ability, flavor: pokedexEntry(base.baseName, base.energyType, variantFlavor(def.flavor, 'rainbow')),
    variant: 'rainbow', rarityFloor: 'secret',
    extra: { packId: 'secret', secret: true },
  }));
}

for (const p of PROMOS) {
  push(makeCard({
    key: p.id, name: p.name, typeId: p.type, stage: 'Promo',
    hp: p.hp, retreat: p.retreat, attacks: p.attacks, ability: p.ability,
    flavor: pokedexEntry(p.name, p.type, p.flavor),
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
  { id: 'basics',  name: 'Basics',         tagline: 'One Creature for every energy type — where a collection starts', order: 10 },
  { id: 'max',     name: 'MAX Cards',      tagline: 'Oversized HP, silver frame, damage that ends the game',    order: 30 },
  { id: 'fullart', name: 'Full Art',       tagline: 'Dark metallic frame, text floating below your photo',      order: 40 },
  { id: 'secret',  name: 'Secret Rare',    tagline: 'Rainbow foil, numbered past the end of the set',           order: 60 },
];

export const SET = {
  id: 'PP-BASE',
  name: 'Pocket Creatures — Base Set',
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
