/**
 * Palheta de cores usada para identificar partidos.
 *
 * As cores são uma referência gráfica consolidada em sites de eleições
 * e mídia brasileira (Tupy, UNIÃO, veículos especializados) e servem à
 * identidade visual, não a uma afiliação oficial de nenhuma sigla.
 * A cor "map" e escolhida para o choroplete (maior contraste), a "primary"
 * serve para chip e célula e "light" e usada como fundo sutil.
 */
export interface PartyColor {
  primary: string;
  map: string;
  light: string;
  dark: string;
}

// Normaliza sigla: maiúscula, sem acento, sem espaços/pontos/traços.
const NORMALIZED = (sigla: string | null | undefined): string =>
  (sigla ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Apelidos e siglas antigas -> chave canônica. */
const ALIASES: Record<string, string> = {
  PODEMOS: 'PODE',
  UNIAOBRASIL: 'UNIAO',
  UNIAODOBRASIL: 'UNIAO',
  DEM: 'UNIAO',
  PSL: 'PL',
  PROGRESSISTAS: 'PP',
  VERDE: 'PV',
  REDE18: 'REDE',
  PT13: 'PT',
  PL22: 'PL',
  MOBILIZANACIONAL: 'MOBILIZA',
  PMB: 'MOBILIZA',
  AGIR36: 'AGIR',
  SOLIDARIEDADE77: 'SD',
};

const CANONICAL = (sigla: string | null | undefined): string => {
  const key = NORMALIZED(sigla);
  return ALIASES[key] ?? key;
};

export const PARTIDO_COLORS: Record<string, PartyColor> = {
  PT: { primary: '#C8102E', map: '#8E0B21', light: '#F9DCE1', dark: '#6E0819' },
  PSOL: { primary: '#F5A800', map: '#B87B00', light: '#FBEFD0', dark: '#7A5200' },
  PCDOB: { primary: '#D40000', map: '#8F0000', light: '#F6D2D2', dark: '#6E0000' },
  PCB: { primary: '#E30613', map: '#9A040D', light: '#FAD2D5', dark: '#6E030A' },
  PSTU: { primary: '#B71C1C', map: '#7C1212', light: '#F0D2D2', dark: '#5C0D0D' },
  UP: { primary: '#1A1A1A', map: '#000000', light: '#E2E2E2', dark: '#000000' },
  PCO: { primary: '#CC0000', map: '#8A0000', light: '#F3CFCF', dark: '#660000' },
  PSB: { primary: '#F2A900', map: '#B87B00', light: '#FBEFD0', dark: '#7A5200' },
  PDT: { primary: '#004B8D', map: '#00335F', light: '#D3E2F0', dark: '#00233F' },
  SD: { primary: '#F37021', map: '#B05115', light: '#FADFC8', dark: '#7A3A0E' },
  SOLIDARIEDADE: { primary: '#F37021', map: '#B05115', light: '#FADFC8', dark: '#7A3A0E' },
  AVANTE: { primary: '#E30613', map: '#9A040D', light: '#FAD2D5', dark: '#6E030A' },
  PV: { primary: '#199A44', map: '#0F6B2E', light: '#D5EDDB', dark: '#0B4E22'},
  REDE: { primary: '#3CA08C', map: '#256656', light: '#D4ECE6', dark: '#17453A'},
  MDB: { primary: '#009739', map: '#006B29', light: '#D2EDDA', dark: '#004D20'},
  PSD: { primary: '#F26522', map: '#B04A17', light: '#FADCC8', dark: '#7A320F' },
  CIDADANIA: { primary: '#EC008C', map: '#A80064', light: '#FAD1E8', dark: '#7A0049'},
  AGIR: { primary: '#00A0DF', map: '#00729F', light: '#D1EDF8', dark: '#005066'},
  MOBILIZA: { primary: '#2E3192', map: '#1D2066', light: '#DADBF0', dark: '#12143F'},
  PMB: { primary: '#2E3192', map: '#1D2066', light: '#DADBF0', dark: '#12143F'},
  DC: { primary: '#1B2A6B', map: '#111C48', light: '#D4D8E9', dark: '#0A102E' },
  MISSAO: { primary: '#1A1A1A', map: '#000000', light: '#E2E2E2', dark: '#000000'},
  REPUBLICANOS: { primary: '#0F3B82', map: '#0A2959', light: '#D2DDF0', dark: '#061B3D'},
  UNIAO: { primary: '#00A0DF', map: '#006B94', light: '#CFEDF9', dark: '#004A6B' },
  PP: { primary: '#0198CB', map: '#016B90', light: '#D1ECF5', dark: '#01485E' },
  // Removido: duplicata da chave REPUBLICANOS (a entrada original com #0F3B82 fica embaixo).
  PSDB: { primary: '#0B4DA2', map: '#07346E', light: '#D2DFF2', dark: '#04234A' },
  PODE: { primary: '#018B4D', map: '#016138', light: '#D1EBDD', dark: '#014026' },
  NOVO: { primary: '#F26522', map: '#B04A17', light: '#FADCC8', dark: '#7A320F'},
  PRD: { primary: '#003DA5', map: '#00296E', light: '#D2DDF2', dark: '#001A48' },
  PL: { primary: '#002776', map: '#001A52', light: '#D2D8EA', dark: '#000F38'},
  PRTB: { primary: '#009444', map: '#00662F', light: '#CDE9D8', dark: '#004620'},
};

/** Cores típicas por orientação ideológica (apoio visual, não oficial). */
export const IDEOLOGIA_COLORS: Record<string, { primary: string; map: string; light: string; dark: string }> = {
  'Esquerda': { primary: '#C8102E', map: '#8E0B21', light: '#F9DCE1', dark: '#6E0819' },
  'Centro-esquerda': { primary: '#E67E22', map: '#A85912', light: '#FDE3CC', dark: '#7A3E0C' },
  'Centro': { primary: '#6B7280', map: '#424957', light: '#E5E7EB', dark: '#2B3138' },
  'Centro-direita': { primary: '#2E86AB', map: '#1F5C80', light: '#D5E9F5', dark: '#143A52' },
  'Direita': { primary: '#002776', map: '#001A52', light: '#D2D8EA', dark: '#000F38' },
  'Ecologista': { primary: '#199A44', map: '#0F6B2E', light: '#D5EDDB', dark: '#0B4E22' },
  'Outros': { primary: '#9AA5B1', map: '#5B6770', light: '#EDEFF2', dark: '#34404A' },
};




/** Certifique-se de que a sigla sempre retorna estilos validos (sem quebrar o layout). */
export function partidoColor(sigla: string | null | undefined): PartyColor {
  const key = CANONICAL(sigla);
  return PARTIDO_COLORS[key] ?? OUTRO_PARTIDO;
}



/** Texto claro ou escuro com contraste legível sobre o fundo do partido. */
export function partidoTextoSobre(sigla: string | null | undefined): string {
  const background = partidoColor(sigla).primary;
  const hex = background.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const red = parseInt(full.slice(0, 2), 16) / 255;
  const green = parseInt(full.slice(2, 4), 16) / 255;
  const blue = parseInt(full.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.55 ? '#1a1d21' : '#ffffff';
}

/** Rampa sequencial (claro → cor do partido) para coropléticos por voto. */
export function partidoRampa(sigla: string | null | undefined, passos = 5): string[] {
  const base = partidoColor(sigla);
  return rampaPara(base.light, base.map, passos);
}

/** Rampa sequencial da ideologia para gráficos neutros por orientação. */
export function ideologiaRampa(ideologia: string | null | undefined, passos = 5): string[] {
  const key = (ideologia ?? '').trim() || 'Outros';
  const base = IDEOLOGIA_COLORS[key] ?? IDEOLOGIA_COLORS['Outros'];
  return rampaPara(base.light, base.map, passos);
}

function rampaPara(inicio: string, fim: string, passos: number): string[] {
  const from = hexParaRgb(inicio);
  const to = hexParaRgb(fim);
  const total = Math.max(2, passos);
  return Array.from({ length: total }, (_, index) => {
    const t = total === 1 ? 1 : index / (total - 1);
    const mix = {
      r: Math.round(from.r + (to.r - from.r) * t),
      g: Math.round(from.g + (to.g - from.g) * t),
      b: Math.round(from.b + (to.b - from.b) * t),
    };
    return `#${[mix.r, mix.g, mix.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  });
}

function hexParaRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

const OUTRO_PARTIDO: PartyColor = {
  primary: '#9AA5B1',
  map: '#5B6770',
  light: '#EDEFF2',
  dark: '#34404A',
};
