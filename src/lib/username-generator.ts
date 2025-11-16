const prefixes = [
  'Grid',
  'Lexi',
  'Vowel',
  'Consonant',
  'Cipher',
  'Puzzle',
  'Tile',
  'Glyph',
  'Rowdy',
  'Goofy',
  'Quirky',
  'Cartoon',
  'Zesty',
  'Turbo',
  'Nebula',
  'Cosmo',
  'Nova',
  'Mega',
  'Ultra',
  'Pixel',
  'Retro',
  'Wordy',
  'Clue',
  'Riddle',
  'Cipher',
  'Spell',
  'Letter',
  'Jumble',
  'Clever',
  'Snazzy',
];

const suffixes = [
  'Spinner',
  'Shuffler',
  'Sleuth',
  'Hero',
  'Oracle',
  'Ranger',
  'Bandit',
  'Vortex',
  'Aura',
  'Bolt',
  'Crafter',
  'Dynamo',
  'Chroma',
  'Grid',
  'Muse',
  'Scout',
  'Puzzle',
  'Solver',
  'Row',
  'Flux',
  'Glyph',
  'Beast',
  'Punk',
  'Sprite',
  'Echo',
  'Guru',
  'Pilot',
  'Knight',
  'Champ',
];

const endings = ['.io', 'XL', '64', '2000', 'Prime', 'X', 'XP', '7', '77', '101', '', '', ''];

export const generateGuestHandle = () => {
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  const ending = endings[Math.floor(Math.random() * endings.length)];
  return `${prefix}${suffix}${ending}`;
};
