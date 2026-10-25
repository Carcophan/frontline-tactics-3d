import {
  CONTINENTS,
  ContinentId,
  TERRITORIES,
  TERRITORY_MAP,
} from './mapData';

export type TurnPhase = 'REINFORCE' | 'ATTACK' | 'FORTIFY' | 'GAME_OVER';

export type GameMode =
  | 'WORLD_DOMINATION'
  | 'SECRET_MISSIONS'
  | 'CAPITALS'
  | 'DOMINATION_70'
  | 'TURN_LIMIT';

export interface GameModeDef {
  id: GameMode;
  name: string;
  shortName: string;
  icon: string;
  tagline: string;
  rules: string;
}

export const GAME_MODES: Record<GameMode, GameModeDef> = {
  WORLD_DOMINATION: {
    id: 'WORLD_DOMINATION',
    name: 'Weltherrschaft (Klassisch)',
    shortName: 'Weltherrschaft',
    icon: '🌍',
    tagline: 'Erobere alle 42 Gebiete der Erde und eliminiere jeden Gegner.',
    rules:
      'Klassische Weltherrschaft: Das Spiel endet erst, wenn ein einziger Kommandant alle 42 Gebiete auf der Weltkarte kontrolliert.',
  },
  SECRET_MISSIONS: {
    id: 'SECRET_MISSIONS',
    name: 'Geheime Missionen',
    shortName: 'Missionen',
    icon: '🕵️',
    tagline: 'Erfülle deinen verdeckten Spezialauftrag vor allen anderen.',
    rules:
      'Jeder Kommandant zieht zu Spielbeginn eine geheime Missionskarte (z. B. bestimmte Kontinente erobern, 18 Gebiete mit je 2+ Truppen sichern oder einen bestimmten Rivalen ausschalten). Wer seinen Auftrag zuerst erfüllt, gewinnt sofort!',
  },
  CAPITALS: {
    id: 'CAPITALS',
    name: 'Hauptstädte (Capital Risk)',
    shortName: 'Hauptstädte',
    icon: '🏛️',
    tagline: 'Halte alle Hauptstädte der Welt (+2 Verstärkung pro Hauptstadt).',
    rules:
      'Jeder Spieler startet mit einer schwer befestigten Hauptstadt (🏛️ +4 Start-Truppen). Jede gehaltene Hauptstadt liefert +2 Bonus-Verstärkungen pro Runde. Wer gleichzeitig alle Hauptstädte kontrolliert, erringt sofort den Sieg!',
  },
  DOMINATION_70: {
    id: 'DOMINATION_70',
    name: '70% Dominanz (Schnellspiel)',
    shortName: '70% Dominanz',
    icon: '⚡',
    tagline: 'Erreiche zuerst 70% der Welt (30 von 42 Gebieten).',
    rules:
      'Dynamischer Turniermodus ohne langwieriges Aufräumen im Endspiel: Wer zuerst 30 der 42 Gebiete (70% der Welt) gleichzeitig hält, gewinnt sofort!',
  },
  TURN_LIMIT: {
    id: 'TURN_LIMIT',
    name: 'Runden-Blitz (12 Runden)',
    shortName: '12 Runden',
    icon: '⏱️',
    tagline: 'Höchster Kampagnen-Score nach 12 Runden gewinnt.',
    rules:
      'Zeitlich begrenztes Gefecht über maximal 12 Runden. Falls niemand vorher die Weltherrschaft erringt, gewinnt am Ende von Runde 12 der Kommandant mit dem höchsten Live-Score (Gebiete, Kontinente, Truppen & Eroberungen).',
  },
};

export type MissionType =
  | 'CONTINENTS'
  | 'TERRITORIES_24'
  | 'TERRITORIES_18_TROOPS_2'
  | 'ELIMINATE_PLAYER';

export interface SecretMission {
  id: string;
  title: string;
  description: string;
  type: MissionType;
  requiredContinents?: ContinentId[];
  extraContinentsCount?: number;
  targetPlayerId?: number;
  fallbackTo24?: boolean;
}

export interface ObjectiveCheckItem {
  label: string;
  done: boolean;
  detail?: string;
}

export interface PlayerObjectiveStatus {
  mode: GameMode;
  title: string;
  description: string;
  progressPct: number;
  badgeText: string;
  checklist: ObjectiveCheckItem[];
  isCompleted: boolean;
}

export type CardSymbol = 'infantry' | 'cavalry' | 'artillery' | 'wild';

export interface RiskCard {
  id: string;
  territoryId: string | null; // null for wild cards
  symbol: CardSymbol;
}

export interface Player {
  id: number;
  name: string;
  isAI: boolean;
  colorHex: number;
  colorCss: string;
  eliminated: boolean;
  cards: RiskCard[];
  aiPersonality: 'grandmaster_conqueror' | 'grandmaster_strategist' | 'grandmaster_bounty';
  conquests: number;
  eliminations: number;
  mission: SecretMission | null;
  capitalTerritoryId: string | null;
}

export interface PlayerRankingEntry {
  rank: number;
  player: Player;
  score: number;
  territories: number;
  worldDominationPct: number;
  troops: number;
  continents: ContinentId[];
  reinforcementsPerTurn: number;
  conquests: number;
}

export interface TerritoryState {
  id: string;
  ownerId: number;
  troops: number;
}

export interface PendingConquestMove {
  fromId: string;
  toId: string;
  minMove: number;
  maxMove: number;
}

export const PLAYER_CONFIGS = [
  {
    name: 'Kommandant (Du)',
    colorHex: 0x3b82f6,
    colorCss: '#3b82f6',
    aiPersonality: 'grandmaster_strategist' as const,
  },
  {
    name: 'GM Alpha-Zero (KI)',
    colorHex: 0xef4444,
    colorCss: '#ef4444',
    aiPersonality: 'grandmaster_conqueror' as const,
  },
  {
    name: 'GM Sun Tzu (KI)',
    colorHex: 0x10b981,
    colorCss: '#10b981',
    aiPersonality: 'grandmaster_strategist' as const,
  },
  {
    name: 'GM Napoleon (KI)',
    colorHex: 0xf59e0b,
    colorCss: '#f59e0b',
    aiPersonality: 'grandmaster_bounty' as const,
  },
];

// Classic Risk progressive card trade-in bonuses: 4, 6, 8, 10, 12, 15, 20, 25, 30...
export function getCardTradeBonus(tradeCount: number): number {
  const bonuses = [4, 6, 8, 10, 12, 15];
  if (tradeCount < bonuses.length) {
    return bonuses[tradeCount];
  }
  return 15 + (tradeCount - bonuses.length + 1) * 5;
}

export class GameState {
  public gameMode: GameMode = 'WORLD_DOMINATION';
  public maxTurns = 12;
  public players: Player[] = [];
  public territories: Record<string, TerritoryState> = {};
  public capitalTerritoryIds: Record<number, string> = {}; // originalOwnerId -> territoryId
  public deck: RiskCard[] = [];
  public discardPile: RiskCard[] = [];
  public cardTradesCompleted = 0;

  public currentPlayerIndex = 0;
  public turnNumber = 1;
  public phase: TurnPhase = 'REINFORCE';
  public reinforcementsRemaining = 0;
  public conqueredThisTurn = false;
  public pendingConquestMove: PendingConquestMove | null = null;
  public winnerId: number | null = null;
  public victoryReason = '';
  public logs: string[] = [];

  constructor(
    totalPlayers = 4,
    humanCount = 1,
    gameMode: GameMode = 'WORLD_DOMINATION'
  ) {
    this.initNewGame(totalPlayers, humanCount, gameMode);
  }

  public initNewGame(
    totalPlayers = 4,
    humanCount = 1,
    gameMode: GameMode = this.gameMode
  ): void {
    this.gameMode = gameMode;
    this.maxTurns = 12;
    this.capitalTerritoryIds = {};
    this.victoryReason = '';

    const count = Math.min(4, Math.max(2, totalPlayers));
    this.players = [];
    for (let i = 0; i < count; i++) {
      const cfg = PLAYER_CONFIGS[i];
      const isAI = i >= humanCount;
      this.players.push({
        id: i,
        name: isAI
          ? cfg.name
          : i === 0
          ? 'Kommandant (Du)'
          : `Spieler ${i + 1}`,
        isAI,
        colorHex: cfg.colorHex,
        colorCss: cfg.colorCss,
        eliminated: false,
        cards: [],
        aiPersonality: cfg.aiPersonality,
        conquests: 0,
        eliminations: 0,
        mission: null,
        capitalTerritoryId: null,
      });
    }

    // Build Risk Card Deck (42 territory cards + 2 wilds)
    const symbols: CardSymbol[] = ['infantry', 'cavalry', 'artillery'];
    this.deck = TERRITORIES.map((t, idx) => ({
      id: `card_${t.id}`,
      territoryId: t.id,
      symbol: symbols[idx % 3],
    }));
    this.deck.push({ id: 'card_wild_1', territoryId: null, symbol: 'wild' });
    this.deck.push({ id: 'card_wild_2', territoryId: null, symbol: 'wild' });
    this.shuffleDeck();
    this.discardPile = [];
    this.cardTradesCompleted = 0;

    // Distribute territories evenly & randomly
    const shuffledTerritories = [...TERRITORIES].sort(
      () => Math.random() - 0.5
    );
    this.territories = {};
    shuffledTerritories.forEach((t, idx) => {
      const ownerId = idx % count;
      this.territories[t.id] = {
        id: t.id,
        ownerId,
        troops: 1,
      };
    });

    // Starting armies per player according to Risk rules:
    // 2 players: 40, 3 players: 35, 4 players: 30
    const startingArmies = count === 2 ? 40 : count === 3 ? 35 : 30;

    // Distribute remaining starting armies smartly onto border territories
    for (const player of this.players) {
      const owned = this.getPlayerTerritories(player.id);
      let remaining = startingArmies - owned.length;
      while (remaining > 0) {
        // Prefer border territories so the start position is immediately tactical
        const borders = owned.filter((t) => this.isBorderTerritory(t.id));
        const pool = borders.length > 0 ? borders : owned;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        pick.troops += 1;
        remaining--;
      }
    }

    // Mode-specific setup
    if (this.gameMode === 'CAPITALS') {
      this.assignCapitals();
    } else if (this.gameMode === 'SECRET_MISSIONS') {
      this.assignSecretMissions();
    }

    this.currentPlayerIndex = 0;
    this.turnNumber = 1;
    this.phase = 'REINFORCE';
    this.conqueredThisTurn = false;
    this.pendingConquestMove = null;
    this.winnerId = null;
    this.logs = [];

    const modeDef = GAME_MODES[this.gameMode];
    this.addLog(`${modeDef.icon} Spielmodus: ${modeDef.name} gestartet.`);
    if (this.gameMode === 'CAPITALS') {
      const capSummaries = this.players
        .map(
          (p) =>
            `${p.name}: 🏛️ ${
              TERRITORY_MAP[this.capitalTerritoryIds[p.id]].name
            }`
        )
        .join(' | ');
      this.addLog(`Hauptstädte gewählt: ${capSummaries}`);
    } else if (this.gameMode === 'SECRET_MISSIONS') {
      this.addLog(
        `🕵️ Jeder Kommandant hat einen streng geheimen Einsatzbefehl erhalten!`
      );
    }

    this.startPlayerTurn();
  }

  private assignCapitals(): void {
    for (const player of this.players) {
      const owned = this.getPlayerTerritories(player.id);
      if (owned.length === 0) continue;

      // Pick a strong strategic territory (highest troops + friendly neighbors) as capital
      let bestTerr = owned[0];
      let bestScore = -999;
      for (const t of owned) {
        const friendlyNeighbors = TERRITORY_MAP[t.id].neighbors.filter(
          (nId) => this.territories[nId].ownerId === player.id
        ).length;
        const score = t.troops * 2 + friendlyNeighbors * 3;
        if (score > bestScore) {
          bestScore = score;
          bestTerr = t;
        }
      }

      player.capitalTerritoryId = bestTerr.id;
      this.capitalTerritoryIds[player.id] = bestTerr.id;
      // Fortify capital with +4 extra garrison troops
      bestTerr.troops += 4;
    }
  }

  private assignSecretMissions(): void {
    const baseMissions: SecretMission[] = [
      {
        id: 'mission_na_af',
        title: 'Atlantik-Pakt',
        description: 'Erobere die Kontinente Nordamerika und Afrika vollständig.',
        type: 'CONTINENTS',
        requiredContinents: ['north_america', 'africa'],
      },
      {
        id: 'mission_na_au',
        title: 'Pazifik-Dominanz',
        description:
          'Erobere die Kontinente Nordamerika und Australien vollständig.',
        type: 'CONTINENTS',
        requiredContinents: ['north_america', 'australia'],
      },
      {
        id: 'mission_as_sa',
        title: 'Eurasien-Anden-Achse',
        description:
          'Erobere die Kontinente Asien und Südamerika vollständig.',
        type: 'CONTINENTS',
        requiredContinents: ['asia', 'south_america'],
      },
      {
        id: 'mission_as_af',
        title: 'Alte Welt Imperium',
        description: 'Erobere die Kontinente Asien und Afrika vollständig.',
        type: 'CONTINENTS',
        requiredContinents: ['asia', 'africa'],
      },
      {
        id: 'mission_eu_sa_plus1',
        title: 'Drei-Kontinente-Koalition I',
        description:
          'Erobere Europa, Südamerika und mindestens 1 weiteren Kontinent deiner Wahl.',
        type: 'CONTINENTS',
        requiredContinents: ['europe', 'south_america'],
        extraContinentsCount: 1,
      },
      {
        id: 'mission_eu_au_plus1',
        title: 'Drei-Kontinente-Koalition II',
        description:
          'Erobere Europa, Australien und mindestens 1 weiteren Kontinent deiner Wahl.',
        type: 'CONTINENTS',
        requiredContinents: ['europe', 'australia'],
        extraContinentsCount: 1,
      },
      {
        id: 'mission_24_terr',
        title: 'Globale Großmacht (24 Gebiete)',
        description:
          'Erobere und halte mindestens 24 beliebige Gebiete auf der Weltkarte.',
        type: 'TERRITORIES_24',
      },
      {
        id: 'mission_18_troops2',
        title: 'Eiserne Festung (18 Gebiete × 2+)',
        description:
          'Erobere mindestens 18 Gebiete deiner Wahl und besetze jedes davon mit mindestens 2 Truppen.',
        type: 'TERRITORIES_18_TROOPS_2',
      },
    ];

    // Add elimination missions for active players
    for (const target of this.players) {
      baseMissions.push({
        id: `mission_elim_${target.id}`,
        title: `Kopfgeld: ${target.name}`,
        description: `Vernichte ${target.name} vollständig (oder erobere 24 Gebiete, falls ein anderer Spieler ihn vernichtet).`,
        type: 'ELIMINATE_PLAYER',
        targetPlayerId: target.id,
      });
    }

    // Shuffle pool and assign a valid mission to each player (never assign a player to eliminate themselves)
    const shuffled = [...baseMissions].sort(() => Math.random() - 0.5);
    const usedIds = new Set<string>();

    for (const player of this.players) {
      const candidate = shuffled.find(
        (m) =>
          !usedIds.has(m.id) &&
          !(m.type === 'ELIMINATE_PLAYER' && m.targetPlayerId === player.id)
      );
      if (candidate) {
        usedIds.add(candidate.id);
        player.mission = { ...candidate };
      } else {
        player.mission = {
          id: `mission_24_fallback_${player.id}`,
          title: 'Globale Großmacht (24 Gebiete)',
          description:
            'Erobere und halte mindestens 24 beliebige Gebiete auf der Weltkarte.',
          type: 'TERRITORIES_24',
        };
      }
    }
  }

  public isCapitalTerritory(territoryId: string): boolean {
    if (this.gameMode !== 'CAPITALS') return false;
    return Object.values(this.capitalTerritoryIds).includes(territoryId);
  }

  public getPlayerControlledCapitals(playerId: number): string[] {
    if (this.gameMode !== 'CAPITALS') return [];
    return Object.values(this.capitalTerritoryIds).filter(
      (tId) => this.territories[tId]?.ownerId === playerId
    );
  }

  private shuffleDeck(): void {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  public get currentPlayer(): Player {
    return this.players[this.currentPlayerIndex];
  }

  public addLog(msg: string): void {
    this.logs.unshift(`[Runde ${this.turnNumber}] ${msg}`);
    if (this.logs.length > 60) {
      this.logs.length = 60;
    }
  }

  public getPlayerTerritories(playerId: number): TerritoryState[] {
    return Object.values(this.territories).filter(
      (t) => t.ownerId === playerId
    );
  }

  public getPlayerTotalTroops(playerId: number): number {
    return this.getPlayerTerritories(playerId).reduce(
      (sum, t) => sum + t.troops,
      0
    );
  }

  public getPlayerContinents(playerId: number): ContinentId[] {
    const ownedContinents: ContinentId[] = [];
    for (const cId of Object.keys(CONTINENTS) as ContinentId[]) {
      const cTerritories = TERRITORIES.filter((t) => t.continent === cId);
      if (
        cTerritories.every((t) => this.territories[t.id].ownerId === playerId)
      ) {
        ownedContinents.push(cId);
      }
    }
    return ownedContinents;
  }

  public calculateTurnReinforcements(playerId: number): {
    base: number;
    continentBonus: number;
    capitalBonus: number;
    total: number;
    continents: ContinentId[];
  } {
    const ownedCount = this.getPlayerTerritories(playerId).length;
    const base = Math.max(3, Math.floor(ownedCount / 3));
    const continents = this.getPlayerContinents(playerId);
    const continentBonus = continents.reduce(
      (sum, cId) => sum + CONTINENTS[cId].bonus,
      0
    );
    const capitalBonus =
      this.gameMode === 'CAPITALS'
        ? this.getPlayerControlledCapitals(playerId).length * 2
        : 0;
    return {
      base,
      continentBonus,
      capitalBonus,
      total: base + continentBonus + capitalBonus,
      continents,
    };
  }

  /**
   * Calculates a comprehensive live power & achievement score for a player.
   * Formula:
   * - 100 pts per owned territory
   * - 15 pts per active troop on the map
   * - 160 pts per continent bonus point held
   * - 250 pts per Capital held (in CAPITALS mode)
   * - 25 pts per tactic card in hand
   * - 30 pts per territory conquered during the match
   * - 300 pts per opponent eliminated
   */
  public getPlayerScore(playerId: number): number {
    const p = this.players[playerId];
    if (!p) return 0;
    if (p.eliminated) {
      return p.conquests * 30 + p.eliminations * 300;
    }
    const territories = this.getPlayerTerritories(playerId).length;
    const troops = this.getPlayerTotalTroops(playerId);
    const reinf = this.calculateTurnReinforcements(playerId);
    const capScore =
      this.gameMode === 'CAPITALS'
        ? this.getPlayerControlledCapitals(playerId).length * 250
        : 0;
    return (
      territories * 100 +
      troops * 15 +
      reinf.continentBonus * 160 +
      capScore +
      p.cards.length * 25 +
      p.conquests * 30 +
      p.eliminations * 300
    );
  }

  /**
   * Returns all players sorted descending by their live score (non-eliminated first).
   */
  public getScoreRanking(): PlayerRankingEntry[] {
    const totalTerritories = TERRITORIES.length;
    const entries = this.players.map((p) => {
      const territories = this.getPlayerTerritories(p.id).length;
      const troops = this.getPlayerTotalTroops(p.id);
      const reinf = this.calculateTurnReinforcements(p.id);
      const score = this.getPlayerScore(p.id);
      const worldDominationPct = Math.round(
        (territories / totalTerritories) * 100
      );
      return {
        rank: 0,
        player: p,
        score,
        territories,
        worldDominationPct,
        troops,
        continents: reinf.continents,
        reinforcementsPerTurn: p.eliminated ? 0 : reinf.total,
        conquests: p.conquests,
      };
    });

    entries.sort((a, b) => {
      if (a.player.eliminated !== b.player.eliminated) {
        return a.player.eliminated ? 1 : -1;
      }
      if (b.score !== a.score) return b.score - a.score;
      if (b.territories !== a.territories) return b.territories - a.territories;
      return b.troops - a.troops;
    });

    entries.forEach((entry, idx) => {
      entry.rank = idx + 1;
    });

    return entries;
  }

  /**
   * Computes detailed progress and checklist items for a player's objective in the active game mode.
   */
  public getPlayerObjectiveStatus(playerId: number): PlayerObjectiveStatus {
    const player = this.players[playerId];
    const ownedTerrs = this.getPlayerTerritories(playerId);
    const ownedConts = this.getPlayerContinents(playerId);
    const totalTerrs = TERRITORIES.length; // 42

    if (this.gameMode === 'SECRET_MISSIONS' && player?.mission) {
      const m = player.mission;

      if (m.type === 'CONTINENTS') {
        const reqs = m.requiredContinents ?? [];
        const extraNeeded = m.extraContinentsCount ?? 0;
        const checklist: ObjectiveCheckItem[] = [];
        let totalTargetTerrs = 0;
        let currentOwnedInTarget = 0;

        for (const cId of reqs) {
          const cTerrs = TERRITORIES.filter((t) => t.continent === cId);
          const myInCont = cTerrs.filter(
            (t) => this.territories[t.id]?.ownerId === playerId
          ).length;
          totalTargetTerrs += cTerrs.length;
          currentOwnedInTarget += myInCont;
          const isDone = myInCont === cTerrs.length;
          checklist.push({
            label: `${CONTINENTS[cId].name} erobern`,
            done: isDone,
            detail: `${myInCont}/${cTerrs.length}`,
          });
        }

        if (extraNeeded > 0) {
          const otherConts = (Object.keys(CONTINENTS) as ContinentId[]).filter(
            (c) => !reqs.includes(c)
          );
          const ownedExtra = ownedConts.filter((c) => !reqs.includes(c));
          // Find closest non-required continent
          let bestRatio = 0;
          let bestName = '';
          let bestCountStr = '';
          for (const oc of otherConts) {
            const cTerrs = TERRITORIES.filter((t) => t.continent === oc);
            const myInCont = cTerrs.filter(
              (t) => this.territories[t.id]?.ownerId === playerId
            ).length;
            const r = myInCont / cTerrs.length;
            if (r > bestRatio) {
              bestRatio = r;
              bestName = CONTINENTS[oc].name;
              bestCountStr = `${myInCont}/${cTerrs.length}`;
            }
          }
          totalTargetTerrs += 4;
          currentOwnedInTarget += Math.round(bestRatio * 4);
          checklist.push({
            label: `+${extraNeeded} weiterer Kontinent nach Wahl`,
            done: ownedExtra.length >= extraNeeded,
            detail:
              ownedExtra.length >= extraNeeded
                ? CONTINENTS[ownedExtra[0]].name
                : `${bestName} (${bestCountStr})`,
          });
        }

        const isCompleted = checklist.every((c) => c.done);
        const pct = isCompleted
          ? 100
          : Math.min(
              99,
              Math.round(
                (currentOwnedInTarget / Math.max(1, totalTargetTerrs)) * 100
              )
            );
        return {
          mode: this.gameMode,
          title: m.title,
          description: m.description,
          progressPct: pct,
          badgeText: `${pct}% erfüllt`,
          checklist,
          isCompleted,
        };
      }

      if (m.type === 'TERRITORIES_18_TROOPS_2') {
        const fort18Count = ownedTerrs.filter((t) => t.troops >= 2).length;
        const isCompleted = fort18Count >= 18;
        const pct = Math.min(100, Math.round((fort18Count / 18) * 100));
        return {
          mode: this.gameMode,
          title: m.title,
          description: m.description,
          progressPct: pct,
          badgeText: `${fort18Count} / 18 Gebiete (2+ 🪖)`,
          checklist: [
            {
              label: 'Mindestens 18 Gebiete besitzen',
              done: ownedTerrs.length >= 18,
              detail: `${ownedTerrs.length}/18`,
            },
            {
              label: '18 Gebiete mit je mind. 2 Truppen sichern',
              done: isCompleted,
              detail: `${fort18Count}/18`,
            },
          ],
          isCompleted,
        };
      }

      if (m.type === 'ELIMINATE_PLAYER' && !m.fallbackTo24) {
        const targetP =
          m.targetPlayerId !== undefined
            ? this.players[m.targetPlayerId]
            : undefined;
        const targetTerrs = targetP
          ? this.getPlayerTerritories(targetP.id).length
          : 0;
        const isCompleted = Boolean(targetP && targetP.eliminated && this.winnerId === playerId);
        // Progress based on reducing target from 14 territories down to 0
        const pct = isCompleted
          ? 100
          : Math.min(
              95,
              Math.max(5, Math.round(((16 - Math.min(16, targetTerrs)) / 16) * 100))
            );
        return {
          mode: this.gameMode,
          title: m.title,
          description: m.description,
          progressPct: pct,
          badgeText: targetP
            ? `${targetP.name}: ${targetTerrs} Gebiete übrig`
            : `${ownedTerrs.length}/24`,
          checklist: [
            {
              label: `Vernichte ${targetP?.name ?? 'Zielspieler'}`,
              done: isCompleted,
              detail: `${targetTerrs} Gebiete verbleibend`,
            },
            {
              label: 'Ersatzziel (falls fremdeliminert): 24 Gebiete',
              done: ownedTerrs.length >= 24,
              detail: `${ownedTerrs.length}/24`,
            },
          ],
          isCompleted,
        };
      }

      // TERRITORIES_24 or fallbackTo24
      const isCompleted = ownedTerrs.length >= 24;
      const pct = Math.min(100, Math.round((ownedTerrs.length / 24) * 100));
      return {
        mode: this.gameMode,
        title: m.title,
        description: m.description,
        progressPct: pct,
        badgeText: `${ownedTerrs.length} / 24 Gebiete`,
        checklist: [
          {
            label: '24 Gebiete gleichzeitig kontrollieren',
            done: isCompleted,
            detail: `${ownedTerrs.length}/24`,
          },
        ],
        isCompleted,
      };
    }

    if (this.gameMode === 'CAPITALS') {
      const capEntries = Object.entries(this.capitalTerritoryIds);
      const totalCaps = capEntries.length;
      const myCaps = this.getPlayerControlledCapitals(playerId).length;
      const isCompleted = totalCaps > 0 && myCaps === totalCaps;
      const pct =
        totalCaps > 0 ? Math.round((myCaps / totalCaps) * 100) : 0;

      const checklist: ObjectiveCheckItem[] = capEntries.map(
        ([origOwnerId, tId]) => {
          const currentOwner = this.players[this.territories[tId].ownerId];
          const origOwner = this.players[Number(origOwnerId)];
          const troops = this.territories[tId].troops;
          return {
            label: `🏛️ ${TERRITORY_MAP[tId].name} (${origOwner.name.split(' ')[0]})`,
            done: currentOwner.id === playerId,
            detail: `${currentOwner.name.split(' ')[0]} • ${troops} 🪖`,
          };
        }
      );

      return {
        mode: this.gameMode,
        title: 'Alle Hauptstädte erobern',
        description:
          'Kontrolliere alle Hauptstädte gleichzeitig. Jede gehaltene Hauptstadt bringt +2 Verstärkungen pro Runde.',
        progressPct: pct,
        badgeText: `${myCaps} / ${totalCaps} 🏛️`,
        checklist,
        isCompleted,
      };
    }

    if (this.gameMode === 'DOMINATION_70') {
      const target = 30; // 70% of 42 = 29.4 -> 30 territories
      const isCompleted = ownedTerrs.length >= target;
      const pct = Math.min(100, Math.round((ownedTerrs.length / target) * 100));
      return {
        mode: this.gameMode,
        title: '70% Weltherrschaft (30 Gebiete)',
        description:
          'Wer zuerst 30 von 42 Gebieten (70% der Welt) gleichzeitig kontrolliert, erringt den sofortigen Sieg!',
        progressPct: pct,
        badgeText: `${ownedTerrs.length} / ${target} Gebiete`,
        checklist: [
          {
            label: '30 Gebiete kontrollieren (70%)',
            done: isCompleted,
            detail: `${ownedTerrs.length}/30 (${Math.round(
              (ownedTerrs.length / totalTerrs) * 100
            )}%)`,
          },
          {
            label: 'Kontinent-Boni sichern',
            done: ownedConts.length >= 1,
            detail: `${ownedConts.length} Kontinent(e)`,
          },
        ],
        isCompleted,
      };
    }

    if (this.gameMode === 'TURN_LIMIT') {
      const ranking = this.getScoreRanking();
      const myRank =
        ranking.find((r) => r.player.id === playerId)?.rank ?? 1;
      const leader = ranking[0];
      const pct = Math.min(
        100,
        Math.round((this.turnNumber / this.maxTurns) * 100)
      );
      return {
        mode: this.gameMode,
        title: `Runden-Blitz (${this.maxTurns} Runden)`,
        description:
          'Erziele bis zum Ende von Runde 12 den höchsten Kampagnen-Score durch Gebiete, Kontinente und Eroberungen!',
        progressPct: pct,
        badgeText: `Runde ${Math.min(this.turnNumber, this.maxTurns)} / ${
          this.maxTurns
        }`,
        checklist: [
          {
            label: 'Platz #1 im Live Score-Ranking halten',
            done: myRank === 1,
            detail: `Aktuell Platz #${myRank}`,
          },
          {
            label: `Führender: ${leader?.player.name.split(' ')[0] ?? '-'}`,
            done: leader?.player.id === playerId,
            detail: `${leader?.score.toLocaleString('de-DE') ?? 0} Pkt`,
          },
        ],
        isCompleted: this.phase === 'GAME_OVER' && this.winnerId === playerId,
      };
    }

    // Default: WORLD_DOMINATION
    const isCompleted = ownedTerrs.length === totalTerrs;
    const pct = Math.round((ownedTerrs.length / totalTerrs) * 100);
    const activeEnemies = this.players.filter(
      (p) => p.id !== playerId && !p.eliminated
    ).length;

    return {
      mode: this.gameMode,
      title: 'Totale Weltherrschaft',
      description:
        'Erobere alle 42 Gebiete auf der Erde und schalte sämtliche gegnerischen Kommandanten aus.',
      progressPct: pct,
      badgeText: `${ownedTerrs.length} / ${totalTerrs} (${pct}%)`,
      checklist: [
        {
          label: 'Alle 42 Gebiete erobern',
          done: isCompleted,
          detail: `${ownedTerrs.length}/42`,
        },
        {
          label: 'Gegnerische Kommandanten ausschalten',
          done: activeEnemies === 0,
          detail: `${activeEnemies} Gegner übrig`,
        },
      ],
      isCompleted,
    };
  }

  public isBorderTerritory(territoryId: string): boolean {
    const tState = this.territories[territoryId];
    const tDef = TERRITORY_MAP[territoryId];
    return tDef.neighbors.some(
      (nId) => this.territories[nId].ownerId !== tState.ownerId
    );
  }

  public startPlayerTurn(): void {
    const p = this.currentPlayer;
    this.phase = 'REINFORCE';
    this.conqueredThisTurn = false;
    this.pendingConquestMove = null;

    const reinf = this.calculateTurnReinforcements(p.id);
    this.reinforcementsRemaining = reinf.total;

    const contNames = reinf.continents.map((c) => CONTINENTS[c].name).join(', ');
    const capExtra =
      reinf.capitalBonus > 0 ? `, +${reinf.capitalBonus} 🏛️ Hauptstädte` : '';
    this.addLog(
      `${p.name} ist am Zug und erhält +${reinf.total} Verstärkungen${
        contNames || capExtra
          ? ` (${[contNames, capExtra.replace(/^, /, '')]
              .filter(Boolean)
              .join(', ')})`
          : ''
      }.`
    );
  }

  /**
   * Finds valid 3-card trade sets for a player.
   * Valid sets: 3 of same symbol, or 1 of each symbol, or any 2 + 1 wild.
   */
  public findValidCardSet(cards: RiskCard[]): [RiskCard, RiskCard, RiskCard] | null {
    if (cards.length < 3) return null;
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        for (let k = j + 1; k < cards.length; k++) {
          const triplet: [RiskCard, RiskCard, RiskCard] = [
            cards[i],
            cards[j],
            cards[k],
          ];
          if (this.isValidCardTriplet(triplet)) {
            return triplet;
          }
        }
      }
    }
    return null;
  }

  public isValidCardTriplet(triplet: [RiskCard, RiskCard, RiskCard]): boolean {
    const wilds = triplet.filter((c) => c.symbol === 'wild').length;
    if (wilds >= 1) return true;
    const s0 = triplet[0].symbol;
    const s1 = triplet[1].symbol;
    const s2 = triplet[2].symbol;
    // All same
    if (s0 === s1 && s1 === s2) return true;
    // All different
    if (s0 !== s1 && s1 !== s2 && s0 !== s2) return true;
    return false;
  }

  public tradeCards(playerId: number, triplet?: [RiskCard, RiskCard, RiskCard]): number {
    const player = this.players[playerId];
    const set = triplet ?? this.findValidCardSet(player.cards);
    if (!set || !this.isValidCardTriplet(set)) return 0;

    const bonus = getCardTradeBonus(this.cardTradesCompleted);
    this.cardTradesCompleted++;

    // Remove cards from player hand
    const ids = new Set(set.map((c) => c.id));
    player.cards = player.cards.filter((c) => !ids.has(c.id));
    this.discardPile.push(...set);

    // Territory match bonus (+2 troops on owned territory shown on traded card)
    let territoryBonusMsg = '';
    for (const card of set) {
      if (
        card.territoryId &&
        this.territories[card.territoryId].ownerId === playerId
      ) {
        this.territories[card.territoryId].troops += 2;
        territoryBonusMsg = ` (+2 Bonus-Truppen auf ${TERRITORY_MAP[card.territoryId].name})`;
        break;
      }
    }

    this.reinforcementsRemaining += bonus;
    this.addLog(
      `${player.name} tauscht 3 Taktik-Karten für +${bonus} Armeen ein!${territoryBonusMsg}`
    );
    return bonus;
  }

  public placeReinforcement(territoryId: string, count = 1): boolean {
    if (this.phase !== 'REINFORCE') return false;
    const t = this.territories[territoryId];
    if (!t || t.ownerId !== this.currentPlayer.id) return false;
    const amount = Math.min(count, this.reinforcementsRemaining);
    if (amount <= 0) return false;

    t.troops += amount;
    this.reinforcementsRemaining -= amount;

    // Placing reinforcements can complete the "18 territories with >= 2 troops" mission!
    if (this.evaluateModeVictory(this.currentPlayer.id)) {
      return true;
    }

    if (this.reinforcementsRemaining === 0 && this.currentPlayer.cards.length < 5) {
      this.phase = 'ATTACK';
    }
    return true;
  }

  public drawCardForCurrentPlayer(): RiskCard | null {
    if (this.deck.length === 0 && this.discardPile.length > 0) {
      this.deck = [...this.discardPile];
      this.discardPile = [];
      this.shuffleDeck();
    }
    const card = this.deck.pop() ?? null;
    if (card) {
      this.currentPlayer.cards.push(card);
    }
    return card;
  }

  /**
   * Checks if two owned territories are connected via a chain of territories owned by the same player.
   */
  public areConnectedOwned(fromId: string, toId: string, ownerId: number): boolean {
    if (fromId === toId) return true;
    const visited = new Set<string>([fromId]);
    const queue: string[] = [fromId];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const nId of TERRITORY_MAP[curr].neighbors) {
        if (nId === toId && this.territories[nId].ownerId === ownerId) {
          return true;
        }
        if (
          !visited.has(nId) &&
          this.territories[nId].ownerId === ownerId
        ) {
          visited.add(nId);
          queue.push(nId);
        }
      }
    }
    return false;
  }

  /**
   * Returns shortest path of territory IDs between two owned territories, or null.
   */
  public getOwnedPath(fromId: string, toId: string, ownerId: number): string[] | null {
    if (fromId === toId) return [fromId];
    const visited = new Set<string>([fromId]);
    const parent: Record<string, string> = {};
    const queue: string[] = [fromId];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const nId of TERRITORY_MAP[curr].neighbors) {
        if (!visited.has(nId) && this.territories[nId].ownerId === ownerId) {
          visited.add(nId);
          parent[nId] = curr;
          if (nId === toId) {
            const path: string[] = [toId];
            let step = toId;
            while (step !== fromId) {
              step = parent[step];
              path.unshift(step);
            }
            return path;
          }
          queue.push(nId);
        }
      }
    }
    return null;
  }

  public advancePhase(): void {
    if (this.phase === 'REINFORCE') {
      if (this.currentPlayer.cards.length >= 5) {
        this.tradeCards(this.currentPlayer.id);
      }
      if (this.reinforcementsRemaining === 0) {
        this.phase = 'ATTACK';
      }
    } else if (this.phase === 'ATTACK') {
      this.pendingConquestMove = null;
      if (this.evaluateModeVictory(this.currentPlayer.id)) return;
      this.phase = 'FORTIFY';
    } else if (this.phase === 'FORTIFY') {
      this.endTurn();
    }
  }

  public endTurn(): void {
    if (this.phase === 'GAME_OVER') return;

    // Check if the player completed their mission at the end of their turn
    if (this.evaluateModeVictory(this.currentPlayer.id)) {
      return;
    }

    if (this.conqueredThisTurn) {
      this.drawCardForCurrentPlayer();
    }

    // Advance to next non-eliminated player
    const count = this.players.length;
    let wrappedRound = false;
    for (let step = 1; step <= count; step++) {
      const nextIdx = (this.currentPlayerIndex + step) % count;
      if (nextIdx <= this.currentPlayerIndex) {
        this.turnNumber++;
        wrappedRound = true;
      }
      if (!this.players[nextIdx].eliminated) {
        this.currentPlayerIndex = nextIdx;
        break;
      }
    }

    // In TURN_LIMIT mode, check if we just finished the final round (turnNumber > maxTurns)
    if (
      this.gameMode === 'TURN_LIMIT' &&
      wrappedRound &&
      this.turnNumber > this.maxTurns
    ) {
      this.turnNumber = this.maxTurns;
      const ranking = this.getScoreRanking();
      const winner = ranking[0].player;
      this.winnerId = winner.id;
      this.phase = 'GAME_OVER';
      this.victoryReason = `⏱️ Nach ${this.maxTurns} Runden gewinnt ${
        winner.name
      } nach Punkten (${ranking[0].score.toLocaleString('de-DE')} Pkt)!`;
      this.addLog(`🏆 ${this.victoryReason}`);
      return;
    }

    this.startPlayerTurn();
  }

  /**
   * Evaluates whether `playerId` has fulfilled the current game mode's victory condition.
   */
  public evaluateModeVictory(
    playerId: number,
    justEliminatedPlayerId?: number
  ): boolean {
    if (this.phase === 'GAME_OVER') return true;
    const player = this.players[playerId];
    if (!player || player.eliminated) return false;

    // 1. Check if all other players are eliminated (always wins in every mode)
    const activePlayers = this.players.filter((p) => !p.eliminated);
    if (activePlayers.length === 1) {
      const w = activePlayers[0];
      this.winnerId = w.id;
      this.phase = 'GAME_OVER';
      this.victoryReason = `🌍 ${w.name} hat die vollständige Weltherrschaft errungen!`;
      this.addLog(`🏆 ${this.victoryReason}`);
      return true;
    }

    // 2. CAPITALS mode: controlling all capitals
    if (this.gameMode === 'CAPITALS') {
      const allCaps = Object.values(this.capitalTerritoryIds);
      if (
        allCaps.length > 0 &&
        allCaps.every((tId) => this.territories[tId].ownerId === playerId)
      ) {
        this.winnerId = playerId;
        this.phase = 'GAME_OVER';
        this.victoryReason = `🏛️ ${player.name} kontrolliert alle ${allCaps.length} Hauptstädte der Welt!`;
        this.addLog(`🏆 ${this.victoryReason}`);
        return true;
      }
    }

    // 3. DOMINATION_70 mode: controlling >= 30 territories (70% of 42)
    if (this.gameMode === 'DOMINATION_70') {
      const ownedCount = this.getPlayerTerritories(playerId).length;
      if (ownedCount >= 30) {
        this.winnerId = playerId;
        this.phase = 'GAME_OVER';
        this.victoryReason = `⚡ ${player.name} kontrolliert ${ownedCount} von 42 Gebieten (>70% Dominanz)!`;
        this.addLog(`🏆 ${this.victoryReason}`);
        return true;
      }
    }

    // 4. SECRET_MISSIONS mode: check player's secret mission
    if (this.gameMode === 'SECRET_MISSIONS' && player.mission) {
      const m = player.mission;

      if (
        m.type === 'ELIMINATE_PLAYER' &&
        !m.fallbackTo24 &&
        justEliminatedPlayerId !== undefined &&
        m.targetPlayerId === justEliminatedPlayerId
      ) {
        this.winnerId = playerId;
        this.phase = 'GAME_OVER';
        this.victoryReason = `🕵️ Geheime Mission erfüllt (${m.title}): ${player.name} hat ${this.players[justEliminatedPlayerId].name} vernichtet!`;
        this.addLog(`🏆 ${this.victoryReason}`);
        return true;
      }

      const status = this.getPlayerObjectiveStatus(playerId);
      if (status.isCompleted) {
        this.winnerId = playerId;
        this.phase = 'GAME_OVER';
        this.victoryReason = `🕵️ Geheime Mission erfüllt (${m.title}): ${player.name} — ${m.description}`;
        this.addLog(`🏆 ${this.victoryReason}`);
        return true;
      }
    }

    return false;
  }

  public checkEliminationAndVictory(
    attackerId: number,
    defeatedPlayerId: number
  ): { eliminated: boolean; gameOver: boolean } {
    this.players[attackerId].conquests += 1;
    let eliminated = false;

    const remainingDef = this.getPlayerTerritories(defeatedPlayerId).length;
    if (remainingDef === 0 && !this.players[defeatedPlayerId].eliminated) {
      const defeated = this.players[defeatedPlayerId];
      const attacker = this.players[attackerId];
      defeated.eliminated = true;
      attacker.eliminations += 1;
      eliminated = true;

      // Attacker captures all Risk cards from eliminated player!
      const lootedCards = defeated.cards.length;
      if (lootedCards > 0) {
        attacker.cards.push(...defeated.cards);
        defeated.cards = [];
      }

      this.addLog(
        `💥 ${defeated.name} wurde von ${attacker.name} vollständig besiegt! (${lootedCards} Karten erbeutet)`
      );

      // In SECRET_MISSIONS mode, if any third player had `defeatedPlayerId` as their elimination target,
      // their mission converts to the classic fallback: Conquer 24 territories!
      if (this.gameMode === 'SECRET_MISSIONS') {
        for (const p of this.players) {
          if (
            p.id !== attackerId &&
            !p.eliminated &&
            p.mission?.type === 'ELIMINATE_PLAYER' &&
            p.mission.targetPlayerId === defeatedPlayerId
          ) {
            p.mission.fallbackTo24 = true;
            p.mission.title = 'Ersatzziel: 24 Gebiete';
            p.mission.description = `Dein Ziel (${defeated.name}) wurde von einem Rivalen ausgeschaltet. Erobere nun 24 Gebiete nach Wahl!`;
            if (!p.isAI) {
              this.addLog(
                `🕵️ Hinweis: Da ${defeated.name} von ${attacker.name} besiegt wurde, lautet deine Mission nun: Erobere 24 Gebiete!`
              );
            }
          }
        }
      }
    }

    const gameOver = this.evaluateModeVictory(
      attackerId,
      eliminated ? defeatedPlayerId : undefined
    );

    return { eliminated, gameOver };
  }
}
