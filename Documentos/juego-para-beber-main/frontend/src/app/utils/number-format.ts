/** Escalas en español. El tope es miles de millones (10⁹). */
export type MagnitudeId = 'units' | 'thousands' | 'millions' | 'billions';

export interface Magnitude {
  id: MagnitudeId;
  label: string;
  shortLabel: string;
  factor: number;
}

export const MAGNITUDES: Magnitude[] = [
  { id: 'units', label: 'Unidades', shortLabel: 'u', factor: 1 },
  { id: 'thousands', label: 'Miles', shortLabel: 'mil', factor: 1_000 },
  { id: 'millions', label: 'Millones', shortLabel: 'M', factor: 1_000_000 },
  { id: 'billions', label: 'Miles de millones', shortLabel: 'mM', factor: 1_000_000_000 },
];

const esInt = new Intl.NumberFormat('es-ES', {
  maximumFractionDigits: 0,
  useGrouping: true,
});

const esFull = new Intl.NumberFormat('es-ES', {
  maximumFractionDigits: 6,
  useGrouping: true,
});

/** Formatea un número con puntos de millar y coma decimal (1.000,5). */
export function formatEsNumber(value: number): string {
  if (!isFinite(value)) return '';
  return esFull.format(value);
}

/**
 * Reescribe lo que el jugador teclea aplicando puntos de millar al vuelo.
 * El punto es siempre separador de miles; la coma, decimal.
 */
export function formatGuessTyping(raw: string): string {
  const negative = raw.trim().startsWith('-');
  const stripped = raw.replace(/[^\d,]/g, '');
  if (!stripped) return negative ? '-' : '';

  const comma = stripped.indexOf(',');
  const intRaw = comma >= 0 ? stripped.slice(0, comma) : stripped;
  const decRaw = comma >= 0 ? stripped.slice(comma + 1).replace(/,/g, '') : null;

  const intDigits = intRaw.replace(/^0+(?=\d)/, '');
  const grouped = intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  let display = (negative ? '-' : '') + grouped;
  if (comma >= 0) display += ',' + decRaw;
  return display;
}

/** Interpreta el coeficiente escrito (ignora los puntos de millar). */
export function parseGuessCoefficient(display: string): number | null {
  const trimmed = display.trim();
  if (!trimmed || trimmed === '-' || trimmed === ',') return null;

  const negative = trimmed.startsWith('-');
  const cleaned = trimmed.replace(/[^\d,]/g, '');
  if (!cleaned || cleaned === ',') return null;

  const normalized = cleaned.replace(',', '.');
  const value = Number(normalized);
  if (!isFinite(value)) return null;
  return negative ? -value : value;
}

export function resolveGuess(display: string, factor: number): number | null {
  const coeff = parseGuessCoefficient(display);
  if (coeff === null) return null;
  const resolved = coeff * factor;
  return isFinite(resolved) ? resolved : null;
}

export function magnitudeOf(id: MagnitudeId): Magnitude {
  return MAGNITUDES.find(m => m.id === id) ?? MAGNITUDES[0];
}

/** Texto de confirmación: «1 × millón = 1.000.000». */
export function describeResolvedGuess(display: string, magnitude: Magnitude): string {
  const resolved = resolveGuess(display, magnitude.factor);
  if (resolved === null) return '';

  const coeff = parseGuessCoefficient(display);
  if (coeff === null) return '';

  if (magnitude.id === 'units') return describeSpokenNumber(resolved);

  const abs = Math.abs(coeff);
  const label = abs === 1
    ? singularLabel(magnitude.id)
    : magnitude.label.toLowerCase();

  return `${formatEsNumber(coeff)} ${label}  ·  ${formatEsNumber(resolved)}`;
}

/**
 * Lectura drunk-proof: 7000000 → «7.000.000 (7 millones)».
 * Por debajo de mil solo muestra el número agrupado.
 */
export function describeSpokenNumber(value: number): string {
  if (!isFinite(value)) return '';
  const formatted = formatEsNumber(value);
  const spoken = spokenScale(value);
  return spoken ? `${formatted} (${spoken})` : formatted;
}

function spokenScale(value: number): string | null {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `${formatEsNumber(value / 1_000_000_000)} mil millones`;
  }
  if (abs >= 1_000_000) {
    const n = value / 1_000_000;
    const word = Math.abs(n) === 1 ? 'millón' : 'millones';
    return `${formatEsNumber(n)} ${word}`;
  }
  if (abs >= 1_000) {
    return `${formatEsNumber(value / 1_000)} mil`;
  }
  return null;
}

function singularLabel(id: MagnitudeId): string {
  switch (id) {
    case 'thousands': return 'mil';
    case 'millions': return 'millón';
    case 'billions': return 'mil millones';
    default: return 'unidad';
  }
}

export function formatIntegerEs(value: number): string {
  return esInt.format(Math.round(value));
}
