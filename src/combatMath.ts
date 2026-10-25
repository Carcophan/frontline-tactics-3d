/**
 * Official Risk Dice Probabilities & Markov Chain Combat Evaluator
 *
 * Single roll transition probabilities (Attacker losses, Defender losses):
 * - 3 vs 2 (2 total losses):
 *   A wins both (0, 2): 2890 / 7776 ≈ 0.371656
 *   Split 1-1   (1, 1): 2611 / 7776 ≈ 0.335777
 *   D wins both (2, 0): 2275 / 7776 ≈ 0.292567
 *
 * - 2 vs 2 (2 total losses):
 *   A wins both (0, 2): 295 / 1296  ≈ 0.227623
 *   Split 1-1   (1, 1): 420 / 1296  ≈ 0.324074
 *   D wins both (2, 0): 581 / 1296  ≈ 0.448302
 *
 * - 1 vs 2 (1 total loss):
 *   A wins 1    (0, 1): 55 / 216    ≈ 0.254630
 *   D wins 1    (1, 0): 161 / 216   ≈ 0.745370
 *
 * - 3 vs 1 (1 total loss):
 *   A wins 1    (0, 1): 855 / 1296  ≈ 0.659722
 *   D wins 1    (1, 0): 441 / 1296  ≈ 0.340278
 *
 * - 2 vs 1 (1 total loss):
 *   A wins 1    (0, 1): 125 / 216   ≈ 0.578704
 *   D wins 1    (1, 0): 91 / 216    ≈ 0.421296
 *
 * - 1 vs 1 (1 total loss):
 *   A wins 1    (0, 1): 15 / 36     ≈ 0.416667
 *   D wins 1    (1, 0): 21 / 36     ≈ 0.583333
 */

const MAX_DP = 65;

// winProbTable[a][d] = probability that attacker with `a` mobile attacking armies (i.e. total troops - 1)
// defeats `d` defending armies.
const winProbTable: number[][] = Array.from({ length: MAX_DP + 1 }, () =>
  new Float64Array(MAX_DP + 1) as unknown as number[]
);

// expectedRemainingAttackers[a][d] = expected mobile attackers left (0 if attacker fails)
const expectedRemTable: number[][] = Array.from({ length: MAX_DP + 1 }, () =>
  new Float64Array(MAX_DP + 1) as unknown as number[]
);

function initTables() {
  for (let a = 0; a <= MAX_DP; a++) {
    winProbTable[a][0] = a > 0 ? 1.0 : 0.0;
    expectedRemTable[a][0] = a;
  }
  for (let d = 1; d <= MAX_DP; d++) {
    winProbTable[0][d] = 0.0;
    expectedRemTable[0][d] = 0.0;
  }

  for (let a = 1; a <= MAX_DP; a++) {
    for (let d = 1; d <= MAX_DP; d++) {
      const atkDice = Math.min(3, a);
      const defDice = Math.min(2, d);

      let pWin = 0;
      let eRem = 0;

      if (atkDice === 3 && defDice === 2) {
        const p02 = 2890 / 7776;
        const p11 = 2611 / 7776;
        const p20 = 2275 / 7776;
        pWin =
          p02 * winProbTable[a][d - 2] +
          p11 * winProbTable[a - 1][d - 1] +
          p20 * winProbTable[a - 2][d];
        eRem =
          p02 * expectedRemTable[a][d - 2] +
          p11 * expectedRemTable[a - 1][d - 1] +
          p20 * expectedRemTable[a - 2][d];
      } else if (atkDice === 2 && defDice === 2) {
        const p02 = 295 / 1296;
        const p11 = 420 / 1296;
        const p20 = 581 / 1296;
        pWin =
          p02 * winProbTable[a][d - 2] +
          p11 * winProbTable[a - 1][d - 1] +
          p20 * winProbTable[a - 2][d];
        eRem =
          p02 * expectedRemTable[a][d - 2] +
          p11 * expectedRemTable[a - 1][d - 1] +
          p20 * expectedRemTable[a - 2][d];
      } else if (atkDice === 1 && defDice === 2) {
        const p01 = 55 / 216;
        const p10 = 161 / 216;
        pWin = p01 * winProbTable[a][d - 1] + p10 * winProbTable[a - 1][d];
        eRem =
          p01 * expectedRemTable[a][d - 1] + p10 * expectedRemTable[a - 1][d];
      } else if (atkDice === 3 && defDice === 1) {
        const p01 = 855 / 1296;
        const p10 = 441 / 1296;
        pWin = p01 * winProbTable[a][d - 1] + p10 * winProbTable[a - 1][d];
        eRem =
          p01 * expectedRemTable[a][d - 1] + p10 * expectedRemTable[a - 1][d];
      } else if (atkDice === 2 && defDice === 1) {
        const p01 = 125 / 216;
        const p10 = 91 / 216;
        pWin = p01 * winProbTable[a][d - 1] + p10 * winProbTable[a - 1][d];
        eRem =
          p01 * expectedRemTable[a][d - 1] + p10 * expectedRemTable[a - 1][d];
      } else {
        // 1 vs 1
        const p01 = 15 / 36;
        const p10 = 21 / 36;
        pWin = p01 * winProbTable[a][d - 1] + p10 * winProbTable[a - 1][d];
        eRem =
          p01 * expectedRemTable[a][d - 1] + p10 * expectedRemTable[a - 1][d];
      }

      winProbTable[a][d] = pWin;
      expectedRemTable[a][d] = eRem;
    }
  }
}

initTables();

/**
 * Returns the exact probability [0..1] of conquering a territory
 * when attacking from a territory with `attackerTotalTroops` (so `attackerTotalTroops - 1` can attack)
 * against a territory with `defenderTroops`.
 */
export function getConquestProbability(
  attackerTotalTroops: number,
  defenderTroops: number
): number {
  const a = Math.max(0, attackerTotalTroops - 1);
  const d = Math.max(0, defenderTroops);
  if (a === 0) return 0;
  if (d === 0) return 1;
  if (a <= MAX_DP && d <= MAX_DP) {
    return winProbTable[a][d];
  }
  // Normal approximation for huge armies > 65 using 3v2 mean/variance
  // In 3v2: expected attacker loss per 2 casualties is 0.9209, defender loss is 1.0791
  // Ratio of attacker loss per defender loss ≈ 0.8534
  const expectedAtkLost = d * 0.8534;
  const stdDev = Math.sqrt(d * 0.72);
  const z = (a - expectedAtkLost) / Math.max(1, stdDev);
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export function getExpectedRemainingMobileAttackers(
  attackerTotalTroops: number,
  defenderTroops: number
): number {
  const a = Math.max(0, attackerTotalTroops - 1);
  const d = Math.max(0, defenderTroops);
  if (a === 0) return 0;
  if (d === 0) return a;
  if (a <= MAX_DP && d <= MAX_DP) {
    return expectedRemTable[a][d];
  }
  return Math.max(0, a - d * 0.8534);
}

function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1.0 / (1.0 + p * x);
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

export interface DiceRollResult {
  attackerDice: number[]; // sorted descending
  defenderDice: number[]; // sorted descending
  attackerLosses: number;
  defenderLosses: number;
  comparisons: { atk: number; def: number; attackerWon: boolean }[];
}

export function rollCombatDice(
  attackerMobileTroops: number,
  defenderTroops: number
): DiceRollResult {
  const atkCount = Math.min(3, Math.max(1, attackerMobileTroops));
  const defCount = Math.min(2, Math.max(1, defenderTroops));

  const attackerDice: number[] = [];
  for (let i = 0; i < atkCount; i++) {
    attackerDice.push(Math.floor(Math.random() * 6) + 1);
  }
  attackerDice.sort((a, b) => b - a);

  const defenderDice: number[] = [];
  for (let i = 0; i < defCount; i++) {
    defenderDice.push(Math.floor(Math.random() * 6) + 1);
  }
  defenderDice.sort((a, b) => b - a);

  let attackerLosses = 0;
  let defenderLosses = 0;
  const comparisons: { atk: number; def: number; attackerWon: boolean }[] = [];

  const pairs = Math.min(atkCount, defCount);
  for (let i = 0; i < pairs; i++) {
    const atk = attackerDice[i];
    const def = defenderDice[i];
    const attackerWon = atk > def; // Defender wins ties in Risk!
    if (attackerWon) {
      defenderLosses++;
    } else {
      attackerLosses++;
    }
    comparisons.push({ atk, def, attackerWon });
  }

  return {
    attackerDice,
    defenderDice,
    attackerLosses,
    defenderLosses,
    comparisons,
  };
}
