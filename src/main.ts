import * as THREE from 'three';
import { GrandmasterAI } from './ai';
import {
  DiceRollResult,
  getConquestProbability,
  rollCombatDice,
} from './combatMath';
import {
  GAME_MODES,
  GameMode,
  GameState,
  getCardTradeBonus,
} from './gameState';
import { CONTINENTS, ContinentId, TERRITORIES, TERRITORY_MAP } from './mapData';
import { Scene3D } from './scene3d';
import { sound } from './sound';

class FrontlineTacticsApp {
  private state: GameState;
  private scene3d: Scene3D;

  private selectedFromId: string | null = null;
  private selectedToId: string | null = null;
  private reinforceBatchSize = 1;
  private isBusyAnimating = false;
  private lastDiceRoll: DiceRollResult | null = null;
  private aiStatusText = '';
  private configuredTotalPlayers = 4;
  private configuredGameMode: GameMode = 'WORLD_DOMINATION';
  private secretMissionHidden = false;

  // DOM Elements
  private playersBarEl = document.getElementById('players-bar')!;
  private modeBadgeBtnEl = document.getElementById('btn-mode-badge')!;
  private objectivePanelTitleEl = document.getElementById(
    'objective-panel-title'
  )!;
  private objectiveBadgeEl = document.getElementById('objective-badge')!;
  private objectiveBodyEl = document.getElementById('objective-body')!;
  private btnToggleSecretEl = document.getElementById('btn-toggle-secret')!;
  private rankingListEl = document.getElementById('ranking-list')!;
  private rankingRoundBadgeEl = document.getElementById('ranking-round-badge')!;
  private powerBalanceBarEl = document.getElementById('power-balance-bar')!;
  private continentListEl = document.getElementById('continent-list')!;
  private cardsListEl = document.getElementById('player-cards-list')!;
  private nextTradeBadgeEl = document.getElementById('next-trade-bonus')!;
  private btnTradeCards = document.getElementById(
    'btn-trade-cards'
  ) as HTMLButtonElement;
  private logListEl = document.getElementById('log-list')!;
  private commandContentEl = document.getElementById('command-content')!;
  private btnNextPhase = document.getElementById(
    'btn-next-phase'
  ) as HTMLButtonElement;

  constructor() {
    this.state = new GameState(4, 1, 'WORLD_DOMINATION');

    const container = document.getElementById('canvas-container')!;
    const overlay = document.getElementById('label-overlay')!;

    this.scene3d = new Scene3D(
      container,
      overlay,
      (tId) => this.handleTerritoryClick(tId),
      (_tId) => this.syncSceneHighlights()
    );

    this.bindUIEvents();
    this.renderContinentReference();
    this.refreshAll();
  }

  private bindUIEvents(): void {
    // Speed buttons
    document.querySelectorAll('.speed-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        sound.playClick(1.1);
        document
          .querySelectorAll('.speed-btn')
          .forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const spd = Number((btn as HTMLElement).dataset.speed || '1');
        this.scene3d.animationSpeed = spd;
      });
    });

    // Sound Mute/Unmute toggle button
    const btnSound = document.getElementById('btn-sound-toggle');
    btnSound?.addEventListener('click', () => {
      const isMuted = sound.toggleMute();
      btnSound.textContent = isMuted ? '🔇 Ton Aus' : '🔊 Ton An';
    });

    // Toggle Mission & Live Score Ranking right sidebar
    document
      .getElementById('btn-ranking-toggle')
      ?.addEventListener('click', () => {
        sound.playClick();
        const sidebar = document.getElementById('right-sidebar')!;
        sidebar.classList.toggle('hidden');
      });

    // Toggle secret mission visibility
    this.btnToggleSecretEl.addEventListener('click', () => {
      sound.playClick();
      this.secretMissionHidden = !this.secretMissionHidden;
      this.renderObjectivePanel();
    });

    // Toggle continent sidebar visibility on small screens
    document
      .getElementById('btn-continents-info')
      ?.addEventListener('click', () => {
        sound.playClick();
        const panel = document.getElementById('continent-panel')!;
        panel.classList.toggle('hidden');
      });

    // Trade cards button
    this.btnTradeCards.addEventListener('click', () => {
      if (this.isBusyAnimating || this.state.currentPlayer.isAI) return;
      if (this.state.phase !== 'REINFORCE') return;
      const bonus = this.state.tradeCards(this.state.currentPlayer.id);
      if (bonus > 0) {
        sound.playCardTrade();
        this.refreshAll();
      }
    });

    // Next Phase / End Turn button
    this.btnNextPhase.addEventListener('click', () => {
      if (this.isBusyAnimating || this.state.currentPlayer.isAI) return;
      if (this.state.pendingConquestMove) return;

      sound.playPhaseChange();
      this.selectedFromId = null;
      this.selectedToId = null;
      this.lastDiceRoll = null;
      this.scene3d.showBattleArrow(null, null);

      this.state.advancePhase();
      this.refreshAll();
      this.checkAndRunAITurn();
    });

    // New game modal
    const modal = document.getElementById('modal-new-game')!;
    const openModal = () => {
      sound.playClick();
      modal.classList.remove('hidden');
    };
    document.getElementById('btn-new-game')?.addEventListener('click', openModal);
    this.modeBadgeBtnEl.addEventListener('click', openModal);

    document
      .getElementById('btn-cancel-modal')
      ?.addEventListener('click', () => {
        modal.classList.add('hidden');
      });

    // Game mode selector in modal
    const rulesPreviewEl = document.getElementById('mode-rules-preview')!;
    document.querySelectorAll('#opt-game-mode .mode-card-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        sound.playClick(1.05);
        document
          .querySelectorAll('#opt-game-mode .mode-card-btn')
          .forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = ((btn as HTMLElement).dataset.mode ||
          'WORLD_DOMINATION') as GameMode;
        this.configuredGameMode = mode;
        rulesPreviewEl.textContent = GAME_MODES[mode].rules;
      });
    });

    document.querySelectorAll('#opt-total-players .opt-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        sound.playClick(1.05);
        document
          .querySelectorAll('#opt-total-players .opt-btn')
          .forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.configuredTotalPlayers = Number(
          (btn as HTMLElement).dataset.val || '4'
        );
      });
    });

    document
      .getElementById('btn-start-match')
      ?.addEventListener('click', () => {
        sound.playPhaseChange();
        modal.classList.add('hidden');
        this.startNewMatch(
          this.configuredTotalPlayers,
          this.configuredGameMode
        );
      });
  }

  private startNewMatch(totalPlayers: number, gameMode: GameMode): void {
    this.isBusyAnimating = false;
    this.selectedFromId = null;
    this.selectedToId = null;
    this.lastDiceRoll = null;
    this.secretMissionHidden = false;
    this.scene3d.showBattleArrow(null, null);
    this.scene3d.clearActiveDice();
    this.state.initNewGame(totalPlayers, 1, gameMode);
    this.refreshAll();
  }

  private renderContinentReference(): void {
    this.continentListEl.innerHTML = '';
    for (const cId of Object.keys(CONTINENTS) as ContinentId[]) {
      const c = CONTINENTS[cId];
      const count = TERRITORIES.filter((t) => t.continent === cId).length;
      const row = document.createElement('div');
      row.className = 'continent-row';
      const hexStr = '#' + c.baseColor.toString(16).padStart(6, '0');
      row.innerHTML = `
        <span><i class="continent-swatch" style="background:${hexStr}"></i>${c.name} (${count})</span>
        <strong>+${c.bonus} / Runde</strong>
      `;
      this.continentListEl.appendChild(row);
    }
  }

  private handleTerritoryClick(territoryId: string): void {
    if (this.isBusyAnimating) return;
    const player = this.state.currentPlayer;
    if (player.isAI || this.state.phase === 'GAME_OVER') return;
    if (this.state.pendingConquestMove) return;

    const clickedState = this.state.territories[territoryId];

    if (this.state.phase === 'REINFORCE') {
      if (this.state.currentPlayer.cards.length >= 5) {
        // Must trade cards first
        this.state.tradeCards(player.id);
        sound.playCardTrade();
        this.refreshAll();
        return;
      }
      if (clickedState.ownerId === player.id) {
        const amount = Math.min(
          this.reinforceBatchSize,
          this.state.reinforcementsRemaining
        );
        if (amount > 0) {
          this.state.placeReinforcement(territoryId, amount);
          sound.playReinforce(amount);
          const c = TERRITORY_MAP[territoryId].center;
          this.scene3d.addFloatingPopup(
            new THREE.Vector3(c[0], 3.5, c[1]),
            `+${amount}`,
            '#38bdf8'
          );
          this.refreshAll();
        }
      }
      return;
    }

    if (this.state.phase === 'ATTACK') {
      // Clicking own territory with >= 2 troops selects/switches attacker
      if (clickedState.ownerId === player.id) {
        if (clickedState.troops >= 2) {
          sound.playClick(1.0);
          this.selectedFromId = territoryId;
          this.selectedToId = null;
          this.lastDiceRoll = null;
          this.scene3d.showBattleArrow(null, null);
          this.refreshAll();
        }
        return;
      }

      // Clicking enemy territory when we have a selected attacker
      if (
        this.selectedFromId &&
        clickedState.ownerId !== player.id &&
        TERRITORY_MAP[this.selectedFromId].neighbors.includes(territoryId)
      ) {
        sound.playClick(1.25);
        this.selectedToId = territoryId;
        this.lastDiceRoll = null;
        this.scene3d.showBattleArrow(this.selectedFromId, this.selectedToId);
        this.refreshAll();
      }
      return;
    }

    if (this.state.phase === 'FORTIFY') {
      if (clickedState.ownerId !== player.id) return;

      if (!this.selectedFromId) {
        if (clickedState.troops >= 2) {
          sound.playClick(1.0);
          this.selectedFromId = territoryId;
          this.selectedToId = null;
          this.refreshAll();
        }
      } else if (territoryId === this.selectedFromId) {
        sound.playClick(0.85);
        this.selectedFromId = null;
        this.selectedToId = null;
        this.refreshAll();
      } else if (
        this.state.areConnectedOwned(
          this.selectedFromId,
          territoryId,
          player.id
        )
      ) {
        sound.playClick(1.25);
        this.selectedToId = territoryId;
        this.refreshAll();
      } else if (clickedState.troops >= 2) {
        sound.playClick(1.0);
        this.selectedFromId = territoryId;
        this.selectedToId = null;
        this.refreshAll();
      }
    }
  }

  /**
   * Executes a single animated combat roll (or blitz loop) between `selectedFromId` and `selectedToId`.
   */
  private executePlayerAttack(blitz: boolean): void {
    if (!this.selectedFromId || !this.selectedToId || this.isBusyAnimating) {
      return;
    }

    const fromState = this.state.territories[this.selectedFromId];
    const toState = this.state.territories[this.selectedToId];
    if (fromState.troops < 2 || toState.ownerId === fromState.ownerId) {
      return;
    }

    this.isBusyAnimating = true;
    const roll = rollCombatDice(fromState.troops - 1, toState.troops);
    this.lastDiceRoll = roll;

    const atkPlayer = this.state.players[fromState.ownerId];
    const defPlayer = this.state.players[toState.ownerId];

    this.scene3d.animateCombatExchange(
      this.selectedFromId,
      this.selectedToId,
      roll,
      atkPlayer.colorHex,
      defPlayer.colorHex,
      () => {
        fromState.troops -= roll.attackerLosses;
        toState.troops -= roll.defenderLosses;

        if (toState.troops <= 0) {
          // Territory conquered!
          const defeatedOwnerId = toState.ownerId;
          toState.ownerId = atkPlayer.id;
          toState.troops = 0;
          this.state.conqueredThisTurn = true;

          this.scene3d.triggerCaptureCelebration(
            this.selectedToId!,
            atkPlayer.colorHex
          );

          this.state.addLog(
            `⚔️ ${atkPlayer.name} erobert ${
              TERRITORY_MAP[this.selectedToId!].name
            } von ${defPlayer.name}!`
          );

          const outcome = this.state.checkEliminationAndVictory(
            atkPlayer.id,
            defeatedOwnerId
          );
          if (outcome.gameOver) {
            sound.playVictory();
          } else if (outcome.eliminated) {
            sound.playElimination();
          }

          if ((this.state.phase as string) === 'GAME_OVER') {
            this.isBusyAnimating = false;
            this.refreshAll();
            return;
          }

          const minMove = Math.min(roll.attackerDice.length, fromState.troops - 1);
          const maxMove = fromState.troops - 1;

          this.state.pendingConquestMove = {
            fromId: this.selectedFromId!,
            toId: this.selectedToId!,
            minMove,
            maxMove,
          };

          this.isBusyAnimating = false;
          this.refreshAll();
          return;
        }

        // Not yet conquered
        if (fromState.troops < 2) {
          this.state.addLog(
            `🛡️ ${defPlayer.name} hält ${
              TERRITORY_MAP[this.selectedToId!].name
            } erfolgreich!`
          );
          this.selectedToId = null;
          this.scene3d.showBattleArrow(null, null);
          this.isBusyAnimating = false;
          this.refreshAll();
          return;
        }

        this.isBusyAnimating = false;
        this.refreshAll();

        if (blitz && fromState.troops >= 2 && toState.troops > 0) {
          this.executePlayerAttack(true);
        }
      }
    );
  }

  private confirmConquestMove(amount: number): void {
    const pending = this.state.pendingConquestMove;
    if (!pending || this.isBusyAnimating) return;

    const fromState = this.state.territories[pending.fromId];
    const toState = this.state.territories[pending.toId];
    const moveCount = Math.min(
      pending.maxMove,
      Math.max(pending.minMove, amount)
    );

    this.isBusyAnimating = true;
    fromState.troops -= moveCount;
    this.state.pendingConquestMove = null;

    const player = this.state.currentPlayer;
    this.scene3d.animateTroopMovement(
      [pending.fromId, pending.toId],
      player.colorHex,
      moveCount,
      () => {
        toState.troops += moveCount;
        // Moving troops into the conquered territory might complete the "18 territories with 2+ troops" mission!
        if (this.state.evaluateModeVictory(player.id)) {
          sound.playVictory();
          this.selectedFromId = null;
          this.selectedToId = null;
          this.scene3d.showBattleArrow(null, null);
          this.isBusyAnimating = false;
          this.refreshAll();
          return;
        }

        // Automatically select the newly conquered territory if it can keep attacking
        if (toState.troops >= 2) {
          this.selectedFromId = pending.toId;
        } else {
          this.selectedFromId = null;
        }
        this.selectedToId = null;
        this.scene3d.showBattleArrow(null, null);
        this.isBusyAnimating = false;

        // If eliminating an opponent gave us >= 5 Risk cards during ATTACK, let player trade immediately!
        if (player.cards.length >= 5) {
          this.state.phase = 'REINFORCE';
        }

        this.refreshAll();
      }
    );
  }

  private confirmFortifyMove(amount: number): void {
    if (
      !this.selectedFromId ||
      !this.selectedToId ||
      this.isBusyAnimating ||
      this.state.phase !== 'FORTIFY'
    ) {
      return;
    }

    const player = this.state.currentPlayer;
    const fromState = this.state.territories[this.selectedFromId];
    const toState = this.state.territories[this.selectedToId];
    const moveCount = Math.min(fromState.troops - 1, Math.max(1, amount));
    if (moveCount <= 0) return;

    const path =
      this.state.getOwnedPath(
        this.selectedFromId,
        this.selectedToId,
        player.id
      ) ?? [this.selectedFromId, this.selectedToId];

    this.isBusyAnimating = true;
    fromState.troops -= moveCount;

    this.state.addLog(
      `🚛 ${player.name} verlegt ${moveCount} Truppen von ${
        TERRITORY_MAP[this.selectedFromId].name
      } nach ${TERRITORY_MAP[this.selectedToId].name}.`
    );

    this.scene3d.animateTroopMovement(
      path,
      player.colorHex,
      moveCount,
      () => {
        toState.troops += moveCount;
        this.selectedFromId = null;
        this.selectedToId = null;
        this.isBusyAnimating = false;
        this.state.endTurn();
        this.refreshAll();
        this.checkAndRunAITurn();
      }
    );
  }

  // ============================================================================
  // GRANDMASTER AI TURN ORCHESTRATOR (Animated & Transparent)
  // ============================================================================
  private checkAndRunAITurn(): void {
    if (this.state.phase === 'GAME_OVER') return;
    if (!this.state.currentPlayer.isAI) return;

    this.isBusyAnimating = true;
    this.runAIReinforceStep();
  }

  private runAIReinforceStep(): void {
    const ai = this.state.currentPlayer;
    if (this.state.phase === 'GAME_OVER') {
      this.isBusyAnimating = false;
      this.refreshAll();
      return;
    }

    // 1. Check card trade
    if (GrandmasterAI.shouldTradeCards(this.state, ai.id)) {
      this.state.tradeCards(ai.id);
      sound.playCardTrade();
      this.refreshAll();
    }

    // 2. Plan and animate reinforcement placements
    const actions = GrandmasterAI.planReinforcements(this.state);
    let idx = 0;

    const placeNext = () => {
      if (idx >= actions.length || this.state.reinforcementsRemaining <= 0) {
        this.state.phase = 'ATTACK';
        this.refreshAll();
        window.setTimeout(
          () => this.runAIAttackStep(),
          Math.max(180, 450 / this.scene3d.animationSpeed)
        );
        return;
      }

      const act = actions[idx++];
      this.aiStatusText = `🤖 ${ai.name}: ${act.reason} (+${act.amount} auf ${
        TERRITORY_MAP[act.territoryId].name
      })`;
      this.state.placeReinforcement(act.territoryId, act.amount);
      sound.playReinforce(act.amount);

      const c = TERRITORY_MAP[act.territoryId].center;
      this.scene3d.addFloatingPopup(
        new THREE.Vector3(c[0], 3.8, c[1]),
        `+${act.amount}`,
        ai.colorCss
      );
      this.selectedFromId = act.territoryId;
      this.refreshAll();

      window.setTimeout(
        placeNext,
        Math.max(220, 580 / this.scene3d.animationSpeed)
      );
    };

    placeNext();
  }

  private runAIAttackStep(): void {
    if (this.state.phase === 'GAME_OVER') {
      this.isBusyAnimating = false;
      this.refreshAll();
      return;
    }

    const ai = this.state.currentPlayer;

    // If AI looted >= 5 cards from eliminating an opponent, trade immediately!
    if (ai.cards.length >= 5) {
      this.state.phase = 'REINFORCE';
      this.runAIReinforceStep();
      return;
    }

    const decision = GrandmasterAI.chooseNextAttack(this.state);
    if (!decision) {
      // Done attacking -> transition to FORTIFY
      this.selectedFromId = null;
      this.selectedToId = null;
      this.scene3d.showBattleArrow(null, null);
      this.state.phase = 'FORTIFY';
      this.refreshAll();
      window.setTimeout(
        () => this.runAIFortifyStep(),
        Math.max(200, 450 / this.scene3d.animationSpeed)
      );
      return;
    }

    this.selectedFromId = decision.fromId;
    this.selectedToId = decision.toId;
    const winPct = Math.round(decision.winProb * 100);
    this.aiStatusText = `⚔️ ${ai.name}: ${decision.reason} (${
      TERRITORY_MAP[decision.fromId].name
    } ➔ ${TERRITORY_MAP[decision.toId].name}, Siegchance ${winPct}%)`;
    this.refreshAll();

    this.executeSingleAICombatWave(decision.fromId, decision.toId);
  }

  private executeSingleAICombatWave(fromId: string, toId: string): void {
    const fromState = this.state.territories[fromId];
    const toState = this.state.territories[toId];
    const atkPlayer = this.state.players[fromState.ownerId];
    const defPlayer = this.state.players[toState.ownerId];

    const roll = rollCombatDice(fromState.troops - 1, toState.troops);
    this.lastDiceRoll = roll;
    this.refreshAll();

    this.scene3d.animateCombatExchange(
      fromId,
      toId,
      roll,
      atkPlayer.colorHex,
      defPlayer.colorHex,
      () => {
        fromState.troops -= roll.attackerLosses;
        toState.troops -= roll.defenderLosses;

        if (toState.troops <= 0) {
          // Conquered!
          const defeatedId = toState.ownerId;
          toState.ownerId = atkPlayer.id;
          toState.troops = 0;
          this.state.conqueredThisTurn = true;

          this.scene3d.triggerCaptureCelebration(toId, atkPlayer.colorHex);
          this.state.addLog(
            `⚔️ ${atkPlayer.name} erobert ${TERRITORY_MAP[toId].name} von ${defPlayer.name}!`
          );
          const outcome = this.state.checkEliminationAndVictory(
            atkPlayer.id,
            defeatedId
          );
          if (outcome.gameOver) {
            sound.playVictory();
          } else if (outcome.eliminated) {
            sound.playElimination();
          }

          if ((this.state.phase as string) === 'GAME_OVER') {
            this.isBusyAnimating = false;
            this.scene3d.showBattleArrow(null, null);
            this.refreshAll();
            return;
          }

          // Choose optimal troop advance count
          const minMove = Math.min(
            roll.attackerDice.length,
            fromState.troops - 1
          );
          const maxMove = fromState.troops - 1;
          const moveCount = GrandmasterAI.chooseConquestMoveCount(
            this.state,
            fromId,
            toId,
            minMove,
            maxMove
          );

          fromState.troops -= moveCount;
          this.scene3d.animateTroopMovement(
            [fromId, toId],
            atkPlayer.colorHex,
            moveCount,
            () => {
              toState.troops += moveCount;
              this.scene3d.showBattleArrow(null, null);
              if (this.state.evaluateModeVictory(atkPlayer.id)) {
                sound.playVictory();
                this.isBusyAnimating = false;
                this.refreshAll();
                return;
              }
              this.refreshAll();
              window.setTimeout(
                () => this.runAIAttackStep(),
                Math.max(150, 320 / this.scene3d.animationSpeed)
              );
            }
          );
          return;
        }

        // Defender still alive: check if AI should continue pressing this attack
        const updatedWinProb = getConquestProbability(
          fromState.troops,
          toState.troops
        );
        if (fromState.troops >= 2 && updatedWinProb >= 0.48) {
          this.refreshAll();
          this.executeSingleAICombatWave(fromId, toId);
        } else {
          this.scene3d.showBattleArrow(null, null);
          this.refreshAll();
          window.setTimeout(
            () => this.runAIAttackStep(),
            Math.max(150, 320 / this.scene3d.animationSpeed)
          );
        }
      }
    );
  }

  private runAIFortifyStep(): void {
    const ai = this.state.currentPlayer;
    const fort = GrandmasterAI.chooseFortification(this.state);

    if (!fort) {
      this.finishAITurn();
      return;
    }

    const fromState = this.state.territories[fort.fromId];
    const toState = this.state.territories[fort.toId];

    this.aiStatusText = `🚛 ${ai.name} verlegt ${fort.amount} Truppen nach ${
      TERRITORY_MAP[fort.toId].name
    }`;
    this.state.addLog(
      `🚛 ${ai.name} verlegt ${fort.amount} Truppen von ${
        TERRITORY_MAP[fort.fromId].name
      } nach ${TERRITORY_MAP[fort.toId].name}.`
    );

    fromState.troops -= fort.amount;
    this.refreshAll();

    this.scene3d.animateTroopMovement(
      fort.path,
      ai.colorHex,
      fort.amount,
      () => {
        toState.troops += fort.amount;
        this.finishAITurn();
      }
    );
  }

  private finishAITurn(): void {
    this.aiStatusText = '';
    this.selectedFromId = null;
    this.selectedToId = null;
    this.lastDiceRoll = null;
    this.state.endTurn();
    this.isBusyAnimating = false;
    this.refreshAll();
    this.checkAndRunAITurn();
  }

  // ============================================================================
  // UI RENDERING & SCENE SYNC
  // ============================================================================
  private syncSceneHighlights(): void {
    const validTargets: string[] = [];
    const p = this.state.currentPlayer;

    if (!p.isAI && !this.state.pendingConquestMove) {
      if (this.state.phase === 'ATTACK' && this.selectedFromId) {
        for (const nId of TERRITORY_MAP[this.selectedFromId].neighbors) {
          if (this.state.territories[nId].ownerId !== p.id) {
            validTargets.push(nId);
          }
        }
      } else if (this.state.phase === 'FORTIFY' && this.selectedFromId) {
        for (const t of this.state.getPlayerTerritories(p.id)) {
          if (
            t.id !== this.selectedFromId &&
            this.state.areConnectedOwned(this.selectedFromId, t.id, p.id)
          ) {
            validTargets.push(t.id);
          }
        }
      }
    }

    this.scene3d.syncWithGameState(
      this.state,
      this.selectedFromId,
      validTargets
    );
  }

  private refreshAll(): void {
    this.syncSceneHighlights();
    this.renderPlayersBar();
    this.renderObjectivePanel();
    this.renderScoreRanking();
    this.renderCardsAndLogs();
    this.renderCommandBar();
  }

  private renderObjectivePanel(): void {
    const modeDef = GAME_MODES[this.state.gameMode];
    this.modeBadgeBtnEl.textContent = `${modeDef.icon} ${modeDef.shortName}`;

    const humanStatus = this.state.getPlayerObjectiveStatus(0);
    const isSecretMode = this.state.gameMode === 'SECRET_MISSIONS';

    this.objectivePanelTitleEl.textContent = isSecretMode
      ? '🕵️ Geheime Mission'
      : `${modeDef.icon} ${modeDef.shortName}`;
    this.objectiveBadgeEl.textContent = humanStatus.badgeText;
    this.btnToggleSecretEl.classList.toggle('hidden', !isSecretMode);

    if (isSecretMode && this.secretMissionHidden) {
      this.objectiveBodyEl.innerHTML = `
        <div class="secret-covered-card">
          <span>🔒 Streng geheimer Einsatzbefehl ausgeblendet</span>
          <small>Klicke oben auf 👁️, um deinen Auftrag einzusehen.</small>
        </div>
      `;
      return;
    }

    const checkItemsHtml = humanStatus.checklist
      .map(
        (item) => `
        <div class="obj-check-row ${item.done ? 'done' : ''}">
          <span class="obj-check-icon">${item.done ? '✅' : '⬜'}</span>
          <span class="obj-check-label">${item.label}</span>
          ${
            item.detail
              ? `<span class="obj-check-detail">${item.detail}</span>`
              : ''
          }
        </div>
      `
      )
      .join('');

    this.objectiveBodyEl.innerHTML = `
      <div class="objective-card ${isSecretMode ? 'secret-theme' : ''}">
        <div class="obj-title-row">
          <strong>${humanStatus.title}</strong>
        </div>
        <p class="obj-desc">${humanStatus.description}</p>
        <div class="obj-progress-track">
          <div class="obj-progress-fill" style="width:${humanStatus.progressPct}%"></div>
        </div>
        <div class="obj-checklist">${checkItemsHtml}</div>
      </div>
    `;
  }

  private renderPlayersBar(): void {
    this.playersBarEl.innerHTML = '';
    const ranking = this.state.getScoreRanking();
    const rankMap = new Map<number, { rank: number; score: number }>();
    for (const r of ranking) {
      rankMap.set(r.player.id, { rank: r.rank, score: r.score });
    }

    for (const p of this.state.players) {
      const terrCount = this.state.getPlayerTerritories(p.id).length;
      const troopCount = this.state.getPlayerTotalTroops(p.id);
      const conts = this.state.getPlayerContinents(p.id);
      const caps = this.state.getPlayerControlledCapitals(p.id).length;
      const isCurrent = this.state.currentPlayer.id === p.id;
      const rInfo = rankMap.get(p.id) ?? { rank: p.id + 1, score: 0 };

      const pill = document.createElement('div');
      pill.className = `player-pill ${isCurrent ? 'active' : ''} ${
        p.eliminated ? 'eliminated' : ''
      }`;
      if (isCurrent) {
        pill.style.borderColor = p.colorCss;
      }

      pill.innerHTML = `
        <div class="player-dot" style="background:${p.colorCss}"></div>
        <div class="player-info">
          <span class="player-name"><span class="player-rank-chip">#${rInfo.rank}</span> ${p.name}</span>
          <span class="player-stats">
            ⭐ ${rInfo.score.toLocaleString('de-DE')} | 🏳️ ${terrCount} | 🪖 ${troopCount} | 🃏 ${p.cards.length}${
        conts.length > 0 ? ` | 🌍 ${conts.length}` : ''
      }${caps > 0 ? ` | 🏛️ ${caps}` : ''}
          </span>
        </div>
      `;
      this.playersBarEl.appendChild(pill);
    }
  }

  private renderScoreRanking(): void {
    const ranking = this.state.getScoreRanking();
    this.rankingRoundBadgeEl.textContent =
      this.state.gameMode === 'TURN_LIMIT'
        ? `Runde ${this.state.turnNumber}/${this.state.maxTurns}`
        : `Runde ${this.state.turnNumber}`;

    // 1. Render global power distribution bar
    this.powerBalanceBarEl.innerHTML = '';
    const totalScore = Math.max(
      1,
      ranking.reduce((sum, r) => sum + (r.player.eliminated ? 0 : r.score), 0)
    );
    for (const entry of ranking) {
      if (entry.player.eliminated || entry.score <= 0) continue;
      const sharePct = (entry.score / totalScore) * 100;
      const seg = document.createElement('div');
      seg.className = 'power-segment';
      seg.style.width = `${sharePct.toFixed(1)}%`;
      seg.style.backgroundColor = entry.player.colorCss;
      seg.title = `${entry.player.name}: ${entry.score.toLocaleString('de-DE')} Pkt (${Math.round(sharePct)}%)`;
      this.powerBalanceBarEl.appendChild(seg);
    }

    // 2. Render live sorted player leaderboard cards
    this.rankingListEl.innerHTML = '';
    const medals = ['🥇', '🥈', '🥉', '4.'];

    for (const entry of ranking) {
      const p = entry.player;
      const isCurrent = this.state.currentPlayer.id === p.id && !p.eliminated;
      const medal = medals[entry.rank - 1] ?? `${entry.rank}.`;

      const item = document.createElement('div');
      item.className = `rank-item ${isCurrent ? 'active-turn' : ''} ${
        p.eliminated ? 'eliminated' : ''
      }`;
      if (isCurrent) {
        item.style.borderColor = p.colorCss;
      }

      item.innerHTML = `
        <div class="rank-top-row">
          <div class="rank-player-wrap">
            <span class="rank-medal">${medal}</span>
            <span class="player-dot" style="background:${p.colorCss};width:10px;height:10px"></span>
            <span class="rank-name">${p.name}</span>
          </div>
          <span class="rank-score-badge">⭐ ${entry.score.toLocaleString('de-DE')} Pkt</span>
        </div>
        <div class="rank-bar-track">
          <div class="rank-bar-fill" style="width:${entry.worldDominationPct}%;background:${p.colorCss}"></div>
        </div>
        <div class="rank-metrics-row">
          <span title="Gebiete & Weltherrschaft">🏳️ ${entry.territories} (${entry.worldDominationPct}%)</span>
          <span title="Truppen & Verstärkungen/Runde">🪖 ${entry.troops} (+${entry.reinforcementsPerTurn})</span>
          <span title="Eroberte Gebiete in diesem Match">⚔️ ${entry.conquests}</span>
        </div>
      `;
      this.rankingListEl.appendChild(item);
    }
  }

  private renderCardsAndLogs(): void {
    const human = this.state.players[0];
    const nextBonus = getCardTradeBonus(this.state.cardTradesCompleted);
    this.nextTradeBadgeEl.textContent = `Nächster Tausch: +${nextBonus}`;

    this.cardsListEl.innerHTML = '';
    if (human.cards.length === 0) {
      this.cardsListEl.innerHTML = `<span style="font-size:11.5px;color:#64748b">Erobere mindestens 1 Gebiet pro Zug für eine Karte.</span>`;
    } else {
      const symIcons: Record<string, string> = {
        infantry: '🪖 Infanterie',
        cavalry: '🐎 Kavallerie',
        artillery: '💣 Artillerie',
        wild: '⭐ Joker',
      };
      for (const c of human.cards) {
        const chip = document.createElement('div');
        chip.className = 'risk-card-chip';
        const terrName = c.territoryId
          ? TERRITORY_MAP[c.territoryId].name
          : 'Alle Symbole';
        chip.innerHTML = `<strong>${symIcons[c.symbol]}</strong> <span>(${terrName})</span>`;
        this.cardsListEl.appendChild(chip);
      }
    }

    const canTrade =
      !this.state.currentPlayer.isAI &&
      this.state.phase === 'REINFORCE' &&
      this.state.findValidCardSet(human.cards) !== null;
    this.btnTradeCards.classList.toggle('hidden', !canTrade);

    // Logs
    this.logListEl.innerHTML = '';
    for (const entry of this.state.logs.slice(0, 25)) {
      const div = document.createElement('div');
      div.className = 'log-item';
      div.textContent = entry;
      this.logListEl.appendChild(div);
    }
  }

  private renderCommandBar(): void {
    // Phase stepper highlight
    document.querySelectorAll('.phase-step').forEach((el) => {
      const ph = (el as HTMLElement).dataset.phase;
      el.classList.toggle('active', ph === this.state.phase);
    });

    const p = this.state.currentPlayer;
    this.commandContentEl.innerHTML = '';

    if (this.state.phase === 'GAME_OVER') {
      const winner =
        this.state.winnerId !== null
          ? this.state.players[this.state.winnerId]
          : p;
      const reasonText =
        this.state.victoryReason ||
        `${winner.name} hat die Schlacht gewonnen!`;
      this.commandContentEl.innerHTML = `
        <div class="cmd-instruction">
          🏆 <strong>${reasonText}</strong>
          <button class="action-btn primary" id="btn-gameover-new">⚙️ Neues Spiel / Modus wählen</button>
        </div>
      `;
      this.commandContentEl
        .querySelector('#btn-gameover-new')
        ?.addEventListener('click', () => {
          document.getElementById('modal-new-game')?.classList.remove('hidden');
        });
      this.btnNextPhase.disabled = true;
      return;
    }

    if (p.isAI) {
      this.btnNextPhase.disabled = true;
      this.btnNextPhase.textContent = 'KI am Zug...';
      this.commandContentEl.innerHTML = `
        <div class="cmd-instruction">
          <span>${
            this.aiStatusText || `🤖 ${p.name} berechnet den optimalen Zug...`
          }</span>
          ${this. renderDiceSummaryHTML()}
        </div>
      `;
      return;
    }

    // Human player's turn
    if (this.state.phase === 'REINFORCE') {
      this.btnNextPhase.disabled = this.state.reinforcementsRemaining > 0;
      this.btnNextPhase.textContent = 'Weiter zum Angriff ➔';

      if (p.cards.length >= 5) {
        this.commandContentEl.innerHTML = `
          <div class="cmd-instruction">
            ⚠️ Du hältst <strong>${p.cards.length} Karten</strong>! Bitte tausche zuerst 3 Karten ein.
          </div>
        `;
        return;
      }

      const wrap = document.createElement('div');
      wrap.className = 'cmd-instruction';
      wrap.innerHTML = `
        <span>🪖 Klicke auf deine Gebiete, um <strong>${this.state.reinforcementsRemaining} Verstärkungen</strong> zu platzieren:</span>
      `;

      const batchSizes = [
        { label: '+1', val: 1 },
        { label: '+5', val: 5 },
        { label: 'Alle', val: 999 },
      ];
      for (const b of batchSizes) {
        const btn = document.createElement('button');
        btn.className = `hud-btn ${
          this.reinforceBatchSize === b.val ? 'primary' : ''
        }`;
        btn.textContent = b.label;
        btn.addEventListener('click', () => {
          this.reinforceBatchSize = b.val;
          this.renderCommandBar();
        });
        wrap.appendChild(btn);
      }

      this.commandContentEl.appendChild(wrap);
      return;
    }

    if (this.state.phase === 'ATTACK') {
      this.btnNextPhase.disabled = Boolean(this.state.pendingConquestMove);
      this.btnNextPhase.textContent = 'Angriff beenden ➔';

      // Check if we have a pending post-conquest troop movement
      const pending = this.state.pendingConquestMove;
      if (pending) {
        const wrap = document.createElement('div');
        wrap.className = 'combat-controls';
        let currentVal = pending.maxMove;

        wrap.innerHTML = `
          <span>🚩 <strong>${
            TERRITORY_MAP[pending.toId].name
          } erobert!</strong> Truppen nachziehen:</span>
          <div class="slider-group">
            <input type="range" id="conquest-slider" min="${
              pending.minMove
            }" max="${pending.maxMove}" value="${currentVal}" />
            <strong id="conquest-val">${currentVal}</strong>
          </div>
          <button class="action-btn" id="btn-move-min">Min (${
            pending.minMove
          })</button>
          <button class="action-btn primary" id="btn-move-confirm">Nachrücken (${currentVal})</button>
        `;
        this.commandContentEl.appendChild(wrap);

        const slider = wrap.querySelector(
          '#conquest-slider'
        ) as HTMLInputElement;
        const valEl = wrap.querySelector('#conquest-val')!;
        const confirmBtn = wrap.querySelector(
          '#btn-move-confirm'
        ) as HTMLButtonElement;

        slider.addEventListener('input', () => {
          currentVal = Number(slider.value);
          valEl.textContent = String(currentVal);
          confirmBtn.textContent = `Nachrücken (${currentVal})`;
        });

        wrap
          .querySelector('#btn-move-min')
          ?.addEventListener('click', () =>
            this.confirmConquestMove(pending.minMove)
          );
        confirmBtn.addEventListener('click', () =>
          this.confirmConquestMove(currentVal)
        );
        return;
      }

      if (!this.selectedFromId) {
        this.commandContentEl.innerHTML = `
          <div class="cmd-instruction">
            ⚔️ Wähle eines deiner Gebiete (mit mind. 2 Truppen) für einen Angriff aus.
          </div>
        `;
        return;
      }

      if (!this.selectedToId) {
        this.commandContentEl.innerHTML = `
          <div class="cmd-instruction">
            🎯 Angreifer: <strong>${
              TERRITORY_MAP[this.selectedFromId].name
            } (${
          this.state.territories[this.selectedFromId].troops
        } 🪖)</strong> — Klicke auf ein gelb markiertes Nachbargebiet!
          </div>
        `;
        return;
      }

      // Both attacker and target selected: show interactive combat controls & exact Markov win probability!
      const fromT = this.state.territories[this.selectedFromId];
      const toT = this.state.territories[this.selectedToId];
      const winProb = Math.round(
        getConquestProbability(fromT.troops, toT.troops) * 100
      );

      const combatDiv = document.createElement('div');
      combatDiv.className = 'combat-controls';
      combatDiv.innerHTML = `
        <span><strong>${TERRITORY_MAP[this.selectedFromId].name}</strong> (${
        fromT.troops
      }) ⚡ <strong>${TERRITORY_MAP[this.selectedToId].name}</strong> (${
        toT.troops
      })</span>
        <span class="win-prob-pill">Siegchance: ${winProb}%</span>
        ${this.renderDiceSummaryHTML()}
        <button class="action-btn danger" id="btn-roll-once">🎲 1x Würfeln</button>
        <button class="action-btn primary" id="btn-roll-blitz">⚡ Blitzkrieg</button>
        <button class="hud-btn" id="btn-cancel-atk">✖</button>
      `;
      this.commandContentEl.appendChild(combatDiv);

      combatDiv
        .querySelector('#btn-roll-once')
        ?.addEventListener('click', () => this.executePlayerAttack(false));
      combatDiv
        .querySelector('#btn-roll-blitz')
        ?.addEventListener('click', () => this.executePlayerAttack(true));
      combatDiv
        .querySelector('#btn-cancel-atk')
        ?.addEventListener('click', () => {
          this.selectedToId = null;
          this.lastDiceRoll = null;
          this.scene3d.showBattleArrow(null, null);
          this.refreshAll();
        });
      return;
    }

    if (this.state.phase === 'FORTIFY') {
      this.btnNextPhase.disabled = false;
      this.btnNextPhase.textContent = 'Zug beenden ➔';

      if (!this.selectedFromId) {
        this.commandContentEl.innerHTML = `
          <div class="cmd-instruction">
            🚛 Optional: Wähle ein eigenes Gebiet (mind. 2 Truppen), um Truppen zu verschieben, oder beende den Zug.
          </div>
        `;
        return;
      }

      if (!this.selectedToId) {
        this.commandContentEl.innerHTML = `
          <div class="cmd-instruction">
            🚛 Quelle: <strong>${
              TERRITORY_MAP[this.selectedFromId].name
            }</strong> — Klicke auf ein verbundenes eigenes Zielgebiet!
          </div>
        `;
        return;
      }

      const fromT = this.state.territories[this.selectedFromId];
      const maxMove = fromT.troops - 1;
      let moveVal = maxMove;

      const fortDiv = document.createElement('div');
      fortDiv.className = 'combat-controls';
      fortDiv.innerHTML = `
        <span>🚛 <strong>${
          TERRITORY_MAP[this.selectedFromId].name
        } ➔ ${TERRITORY_MAP[this.selectedToId].name}</strong></span>
        <div class="slider-group">
          <input type="range" id="fort-slider" min="1" max="${maxMove}" value="${moveVal}" />
          <strong id="fort-val">${moveVal}</strong>
        </div>
        <button class="action-btn primary" id="btn-confirm-fort">Truppen verlegen (${moveVal})</button>
      `;
      this.commandContentEl.appendChild(fortDiv);

      const slider = fortDiv.querySelector('#fort-slider') as HTMLInputElement;
      const valEl = fortDiv.querySelector('#fort-val')!;
      const confirmBtn = fortDiv.querySelector(
        '#btn-confirm-fort'
      ) as HTMLButtonElement;

      slider.addEventListener('input', () => {
        moveVal = Number(slider.value);
        valEl.textContent = String(moveVal);
        confirmBtn.textContent = `Truppen verlegen (${moveVal})`;
      });

      confirmBtn.addEventListener('click', () =>
        this.confirmFortifyMove(moveVal)
      );
    }
  }

  private renderDiceSummaryHTML(): string {
    if (!this.lastDiceRoll) return '';
    const atkChips = this.lastDiceRoll.attackerDice
      .map((d) => `<span class="die-chip atk">${d}</span>`)
      .join('');
    const defChips = this.lastDiceRoll.defenderDice
      .map((d) => `<span class="die-chip def">${d}</span>`)
      .join('');
    return `<div class="dice-summary">${atkChips} <span>vs</span> ${defChips}</div>`;
  }
}

new FrontlineTacticsApp();
