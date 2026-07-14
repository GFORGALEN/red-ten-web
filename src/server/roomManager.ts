import {
  buildDeck,
  getCardValue,
  isHeartThree,
  isHeartTen,
  shuffleCards,
  sortCards,
  validateRoomOptions
} from "../shared/cards";
import { analyzePlay, calculateResult, canBeat, selectedContainsHeartTen } from "../shared/rules";
import type {
  Card,
  GameResult,
  GameState,
  LeadClaimState,
  Player,
  PublicPlay,
  RoomOptions,
  TributePick,
  RoomView
} from "../shared/types";

const ROOM_TTL_MS = 30 * 60 * 1000;
const LEAD_CLAIM_MS = 10 * 1000;

export class RoomManager {
  private readonly rooms = new Map<string, RoomRuntime>();

  constructor(private readonly onRoomChanged: (roomId: string) => void) {}

  createRoom(options: RoomOptions, host: { id: string; nickname: string }): RoomRuntime {
    const roomId = this.createRoomId();
    const room = new RoomRuntime(
      roomId,
      validateRoomOptions(options),
      host,
      () => this.onRoomChanged(roomId),
      () => this.rooms.delete(roomId)
    );
    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId: string): RoomRuntime {
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) {
      throw new Error("房间不存在或已经过期。");
    }
    return room;
  }

  connect(roomId: string, playerId: string): void {
    this.getRoom(roomId).connect(playerId);
  }

  disconnect(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) return;
    room.disconnect(playerId);
  }

  private createRoomId(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      let id = "";
      for (let index = 0; index < 5; index += 1) {
        id += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      if (!this.rooms.has(id)) return id;
    }
    throw new Error("暂时无法创建房间，请重试。");
  }
}

export class RoomRuntime {
  readonly state: GameState;
  private readonly connectedPlayerIds = new Set<string>();
  private cleanupTimer?: NodeJS.Timeout;
  private leadTimer?: NodeJS.Timeout;

  constructor(
    roomId: string,
    options: RoomOptions,
    host: { id: string; nickname: string },
    private readonly notifyChange: () => void,
    private readonly destroy: () => void
  ) {
    const now = Date.now();
    this.state = {
      roomId,
      options,
      phase: "lobby",
      hostId: host.id,
      players: [
        {
          id: host.id,
          nickname: cleanNickname(host.nickname),
          seat: 0,
          hand: [],
          isRedTeam: false,
          isRevealed: false
        }
      ],
      passes: [],
      finishOrder: [],
      createdAt: now,
      updatedAt: now
    };
  }

  connect(playerId: string): void {
    this.connectedPlayerIds.add(playerId);
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.touch();
  }

  disconnect(playerId: string): void {
    this.connectedPlayerIds.delete(playerId);
    this.touch();

    if (this.connectedPlayerIds.size === 0 && !this.cleanupTimer) {
      this.cleanupTimer = setTimeout(() => {
        this.clearTimers();
        this.destroy();
      }, ROOM_TTL_MS);
    }
  }

  join(playerId: string, nickname: string): Player {
    const cleanedNickname = cleanNickname(nickname);
    const existing = this.state.players.find((player) => player.id === playerId);
    if (existing) {
      existing.nickname = cleanedNickname;
      this.touch();
      return existing;
    }

    if (this.state.phase !== "lobby") {
      throw new Error("游戏已经开始，不能加入新玩家。");
    }

    if (this.state.players.length >= this.state.options.playerCount) {
      throw new Error("房间已经满员。");
    }

    const usedSeats = new Set(this.state.players.map((player) => player.seat));
    let seat = 0;
    while (usedSeats.has(seat)) seat += 1;

    const player: Player = {
      id: playerId,
      nickname: cleanedNickname,
      seat,
      hand: [],
      isRedTeam: false,
      isRevealed: false
    };
    this.state.players.push(player);
    this.sortPlayers();
    this.touch();
    return player;
  }

  start(playerId: string): void {
    if (playerId !== this.state.hostId) {
      throw new Error("只有房主可以开始游戏。");
    }

    if (this.state.phase !== "lobby" && this.state.phase !== "finished") {
      throw new Error("当前状态不能开始新局。");
    }

    if (this.state.players.length !== this.state.options.playerCount) {
      throw new Error("需要满员后才能开始。");
    }

    const previousResult = this.state.result;
    const previousFinishRanks = new Map(this.state.players.map((player) => [player.id, player.finishRank]));
    this.clearLeadTimer();
    this.resetPlayersForNewGame();
    this.dealCards();
    this.state.phase = "playing";
    this.state.currentTurn = undefined;
    this.state.lastPlay = undefined;
    this.state.passes = [];
    this.state.finishOrder = [];
    this.state.result = undefined;
    this.state.leadClaim = undefined;
    this.state.tribute = undefined;

    if (previousResult && previousResult.outcome !== "draw") {
      this.setupTribute(previousResult, previousFinishRanks);
      this.touch();
      return;
    }

    this.startOpeningLead();
    this.touch();
  }

  private startOpeningLead(): void {
    const heartThreeCandidates = this.state.players.filter((player) => {
      return player.hand.some(isHeartThree);
    });
    if (heartThreeCandidates.length > 1) {
      this.state.phase = "claimLead";
      this.state.leadClaim = {
        candidatePlayerIds: heartThreeCandidates.map((player) => player.id),
        deadline: Date.now() + LEAD_CLAIM_MS
      };
      this.leadTimer = setTimeout(() => this.resolveLeadBySeat(), LEAD_CLAIM_MS);
    } else {
      this.state.phase = "playing";
      this.state.currentTurn = (heartThreeCandidates[0] ?? this.state.players[0]).id;
    }
  }

  claimLead(playerId: string): void {
    if (this.state.phase !== "claimLead" || !this.state.leadClaim) {
      throw new Error("现在不能抢红桃3首出。");
    }

    if (!this.state.leadClaim.candidatePlayerIds.includes(playerId)) {
      throw new Error("你没有红桃3，不能抢首出。");
    }

    this.setLeadPlayer(playerId);
  }

  revealRed(playerId: string): void {
    const player = this.requirePlayer(playerId);
    if (!player.isRedTeam) {
      throw new Error("你不是红十方。");
    }
    player.isRevealed = true;
    this.touch();
  }

  pickTribute(playerId: string, cardId: string): void {
    if (this.state.phase !== "tribute" || !this.state.tribute) {
      throw new Error("现在不是选贡牌阶段。");
    }

    if (this.state.tribute.currentPickerId !== playerId) {
      throw new Error("还没轮到你选贡牌。");
    }

    const poolIndex = this.state.tribute.pool.findIndex((pick) => pick.card.id === cardId);
    if (poolIndex < 0) {
      throw new Error("这张贡牌不在可选牌池里。");
    }

    const [picked] = this.state.tribute.pool.splice(poolIndex, 1);
    picked.winnerId = playerId;
    this.state.tribute.picks.push(picked);
    this.requirePlayer(playerId).hand = sortCards([...this.requirePlayer(playerId).hand, picked.card]);
    this.state.tribute.returnCounts[playerId] = (this.state.tribute.returnCounts[playerId] ?? 0) + 1;

    if (this.state.tribute.pool.length > 0) {
      this.state.tribute.currentPickerId = this.nextTributeActor(playerId, this.state.tribute.winnerIds);
    } else {
      this.state.tribute.currentPickerId = undefined;
      this.state.tribute.currentReturnerId = this.state.tribute.winnerIds.find((id) => {
        return (this.state.tribute?.returnCounts[id] ?? 0) > 0;
      });
    }

    this.touch();
  }

  returnTribute(playerId: string, cardIds: string[]): void {
    if (this.state.phase !== "tribute" || !this.state.tribute) {
      throw new Error("现在不是返牌阶段。");
    }

    if (this.state.tribute.currentReturnerId !== playerId) {
      throw new Error("还没轮到你返牌。");
    }

    const expectedCount = this.state.tribute.returnCounts[playerId] ?? 0;
    if (cardIds.length !== expectedCount) {
      throw new Error(`需要返还 ${expectedCount} 张牌。`);
    }

    const player = this.requirePlayer(playerId);
    const returnCards = this.takeCardsFromHand(player, cardIds);
    player.hand = player.hand.filter((card) => !cardIds.includes(card.id));

    const playerPicks = this.state.tribute.picks.filter((pick) => pick.winnerId === playerId);
    returnCards.forEach((card, index) => {
      const targetId = playerPicks[index]?.fromPlayerId ?? this.state.tribute!.capturedPlayerIds[0];
      const target = this.requirePlayer(targetId);
      target.hand = sortCards([...target.hand, card]);
    });

    this.state.tribute.returnedCounts[playerId] = expectedCount;
    const nextReturner = this.state.tribute.winnerIds.find((id) => {
      const count = this.state.tribute?.returnCounts[id] ?? 0;
      const returned = this.state.tribute?.returnedCounts[id] ?? 0;
      return count > 0 && returned < count;
    });

    if (nextReturner) {
      this.state.tribute.currentReturnerId = nextReturner;
      this.touch();
      return;
    }

    const leadPlayerId = this.state.tribute.nextLeadPlayerId;
    this.state.tribute = undefined;
    this.state.phase = "playing";
    this.state.result = undefined;
    this.state.currentTurn = leadPlayerId && !this.requirePlayer(leadPlayerId).finishRank ? leadPlayerId : this.state.players[0].id;
    this.state.lastPlay = undefined;
    this.state.passes = [];
    this.touch();
  }

  playCards(playerId: string, cardIds: string[]): void {
    if (this.state.phase !== "playing") {
      throw new Error("还没有进入出牌阶段。");
    }

    if (this.state.currentTurn !== playerId) {
      throw new Error("还没轮到你出牌。");
    }

    const player = this.requirePlayer(playerId);
    if (player.finishRank) {
      throw new Error("你已经出完牌了。");
    }

    const selectedCards = this.takeCardsFromHand(player, cardIds);
    const play = analyzePlay(selectedCards);
    if (!canBeat(play, this.state.lastPlay?.play)) {
      throw new Error("这手牌压不过上家。");
    }

    player.hand = player.hand.filter((card) => !cardIds.includes(card.id));
    if (player.isRedTeam && selectedContainsHeartTen(selectedCards)) {
      player.isRevealed = true;
    }

    const publicPlay: PublicPlay = {
      playerId,
      playerName: player.nickname,
      cards: sortCards(selectedCards),
      play,
      createdAt: Date.now()
    };

    this.state.lastPlay = publicPlay;
    this.state.passes = [];

    if (player.hand.length === 0) {
      this.markFinished(player);
    }

    if (this.finishIfReady()) {
      this.touch();
      return;
    }

    const responder = this.nextResponderAfter(player.seat, playerId);
    if (responder) {
      this.state.currentTurn = responder.id;
    } else {
      this.finishTrickAndLead(publicPlay);
    }

    this.touch();
  }

  pass(playerId: string): void {
    if (this.state.phase !== "playing") {
      throw new Error("还没有进入出牌阶段。");
    }

    if (this.state.currentTurn !== playerId) {
      throw new Error("还没轮到你。");
    }

    if (!this.state.lastPlay) {
      throw new Error("新一轮首出不能过牌。");
    }

    if (this.state.lastPlay.playerId === playerId) {
      throw new Error("你是当前最大牌，不能过自己的牌。");
    }

    if (!this.state.passes.includes(playerId)) {
      this.state.passes.push(playerId);
    }

    const responders = this.eligibleResponders(this.state.lastPlay.playerId);
    if (responders.length === 0) {
      this.finishTrickAndLead(this.state.lastPlay);
    } else {
      const next = this.nextResponderAfter(this.requirePlayer(playerId).seat, this.state.lastPlay.playerId);
      this.state.currentTurn = (next ?? responders[0]).id;
    }

    this.touch();
  }

  getView(playerId: string): RoomView {
    const self = this.state.players.find((player) => player.id === playerId);
    const phaseFinished = this.state.phase === "finished";

    return {
      roomId: this.state.roomId,
      options: this.state.options,
      phase: this.state.phase,
      hostId: this.state.hostId,
      selfPlayerId: playerId,
      selfHand: self ? sortCards(self.hand) : [],
      players: this.state.players.map((player) => {
        const mayKnowRedTeam = phaseFinished || player.id === playerId || player.isRevealed;
        return {
          id: player.id,
          nickname: player.nickname,
          seat: player.seat,
          cardCount: player.hand.length,
          isConnected: this.connectedPlayerIds.has(player.id),
          isHost: player.id === this.state.hostId,
          isSelf: player.id === playerId,
          isRevealed: player.isRevealed,
          isRedTeam: mayKnowRedTeam ? player.isRedTeam : undefined,
          finishRank: player.finishRank
        };
      }),
      currentTurn: this.state.currentTurn,
      lastPlay: this.state.lastPlay,
      passes: this.state.passes,
      finishOrder: this.state.finishOrder,
      result: this.state.result,
      leadClaim: this.state.leadClaim,
      tribute: this.state.tribute,
      canClaimLead:
        this.state.phase === "claimLead" &&
        Boolean(this.state.leadClaim?.candidatePlayerIds.includes(playerId)),
      canPickTribute: this.state.phase === "tribute" && this.state.tribute?.currentPickerId === playerId,
      canReturnTribute: this.state.phase === "tribute" && this.state.tribute?.currentReturnerId === playerId,
      createdAt: this.state.createdAt,
      updatedAt: this.state.updatedAt
    };
  }

  private resetPlayersForNewGame(): void {
    for (const player of this.state.players) {
      player.hand = [];
      player.isRedTeam = false;
      player.isRevealed = false;
      player.finishRank = undefined;
    }
  }

  private dealCards(): void {
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const deck = shuffleCards(buildDeck(this.state.options.deckCount));
      const hands = this.state.players.map<Card[]>(() => []);

      deck.forEach((card, index) => {
        hands[index % this.state.players.length].push(card);
      });

      let redCount = 0;
      this.state.players.forEach((player, index) => {
        player.hand = sortCards(hands[index]);
        player.isRedTeam = player.hand.some(isHeartTen);
        if (player.isRedTeam) redCount += 1;
      });

      if (redCount > 0 && redCount < this.state.players.length) {
        return;
      }
    }

    throw new Error("连续发牌都出现全员红十，请减少副数或增加人数后重试。");
  }

  private setupTribute(result: GameResult, previousFinishRanks: Map<string, number | undefined>): void {
    const originalCapturedIds = result.capturedPlayerIds;
    const originalCapturedIdSet = new Set(originalCapturedIds);
    const originalWinnerIds = this.state.players
      .filter((player) => !originalCapturedIdSet.has(player.id))
      .sort((left, right) => {
        return (
          (previousFinishRanks.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (previousFinishRanks.get(right.id) ?? Number.MAX_SAFE_INTEGER)
        );
      })
      .map((player) => player.id);
    const reverseWinnerIds = originalCapturedIds
      .filter((playerId) => countJokers(this.requirePlayer(playerId).hand) >= 3)
      .sort((left, right) => {
        return (
          (previousFinishRanks.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (previousFinishRanks.get(right) ?? Number.MAX_SAFE_INTEGER)
        );
      });
    const isReversed = reverseWinnerIds.length > 0;
    const capturedIds = isReversed ? originalWinnerIds : originalCapturedIds;
    const winnerIds = isReversed ? reverseWinnerIds : originalWinnerIds;

    const pool: TributePick[] = [];
    for (const playerId of capturedIds) {
      const player = this.requirePlayer(playerId);
      const tributeCards = [...player.hand]
        .sort((left, right) => compareCardsForTribute(right, left))
        .slice(0, Math.min(2, player.hand.length));
      const tributeIds = new Set(tributeCards.map((card) => card.id));
      player.hand = player.hand.filter((card) => !tributeIds.has(card.id));
      tributeCards.forEach((card) => {
        pool.push({
          winnerId: "",
          fromPlayerId: playerId,
          card
        });
      });
    }

    pool.sort((left, right) => compareCardsForTribute(right.card, left.card));
    const leadTribute = [...pool].sort((left, right) => {
      const cardDiff = compareCardsForTribute(right.card, left.card);
      if (cardDiff !== 0) return cardDiff;
      return this.requirePlayer(left.fromPlayerId).seat - this.requirePlayer(right.fromPlayerId).seat;
    })[0];

    if (pool.length === 0 || winnerIds.length === 0) {
      this.state.phase = "playing";
      this.state.currentTurn = leadTribute?.fromPlayerId ?? this.state.players[0].id;
      return;
    }

    this.state.phase = "tribute";
    this.state.currentTurn = undefined;
    this.state.lastPlay = undefined;
    this.state.passes = [];
    this.state.tribute = {
      isReversed,
      winnerIds,
      capturedPlayerIds: capturedIds,
      leaderPlayerId: leadTribute?.fromPlayerId,
      pool,
      picks: [],
      returnCounts: {},
      returnedCounts: {},
      currentPickerId: winnerIds[0],
      nextLeadPlayerId: leadTribute?.fromPlayerId
    };
  }

  private nextTributeActor(currentPlayerId: string, actorIds: string[]): string {
    const currentIndex = actorIds.indexOf(currentPlayerId);
    if (currentIndex < 0) return actorIds[0];
    return actorIds[(currentIndex + 1) % actorIds.length];
  }

  private takeCardsFromHand(player: Player, cardIds: string[]): Card[] {
    const uniqueIds = [...new Set(cardIds)];
    if (uniqueIds.length !== cardIds.length) {
      throw new Error("不能重复选择同一张牌。");
    }

    const handMap = new Map(player.hand.map((card) => [card.id, card]));
    const selectedCards = uniqueIds.map((id) => handMap.get(id));

    if (selectedCards.some((card) => !card)) {
      throw new Error("选择的牌不在你的手牌里。");
    }

    return selectedCards as Card[];
  }

  private resolveLeadBySeat(): void {
    if (this.state.phase !== "claimLead" || !this.state.leadClaim) return;
    const sortedCandidates = this.state.players
      .filter((player) => this.state.leadClaim?.candidatePlayerIds.includes(player.id))
      .sort((left, right) => left.seat - right.seat);
    this.setLeadPlayer(sortedCandidates[0].id);
    this.notifyChange();
  }

  private setLeadPlayer(playerId: string): void {
    this.clearLeadTimer();
    this.state.phase = "playing";
    this.state.currentTurn = playerId;
    this.state.leadClaim = undefined;
    this.touch();
  }

  private markFinished(player: Player): void {
    if (player.finishRank) return;
    this.state.finishOrder.push(player.id);
    player.finishRank = this.state.finishOrder.length;
  }

  private finishIfReady(): boolean {
    const decidedResult = this.calculateDecidedResult();
    if (decidedResult) {
      this.finishGame(decidedResult);
      return true;
    }

    const unfinished = this.state.players.filter((player) => !player.finishRank);
    if (unfinished.length === 1) {
      this.markFinished(unfinished[0]);
    }

    if (this.state.players.every((player) => player.finishRank)) {
      this.finishGame(calculateResult(this.state.players));
      return true;
    }

    return false;
  }

  private finishGame(result: GameResult): void {
    this.clearLeadTimer();
    this.state.phase = "finished";
    this.state.currentTurn = undefined;
    this.state.passes = [];
    this.state.result = result;
  }

  private calculateDecidedResult(): GameResult | undefined {
    const rankedFinished = this.state.players
      .filter((player) => player.finishRank)
      .sort((left, right) => left.finishRank! - right.finishRank!);
    const redPlayers = this.state.players.filter((player) => player.isRedTeam);
    const normalPlayers = this.state.players.filter((player) => !player.isRedTeam);

    if (redPlayers.length === 0 || normalPlayers.length === 0 || rankedFinished.length === 0) {
      return undefined;
    }

    if (redPlayers.length === 1) {
      const redPlayer = redPlayers[0];
      if (redPlayer.finishRank === 1) {
        return {
          outcome: "red_capture",
          winner: "red",
          message: "红十第一名出完，红十方抓全部。",
          capturedPlayerIds: normalPlayers.map((player) => player.id)
        };
      }

      if (rankedFinished[0].id !== redPlayer.id) {
        return {
          outcome: "draw",
          winner: "none",
          message: "单红十没有第一名出完，本局平局。",
          capturedPlayerIds: []
        };
      }

      return undefined;
    }

    const redIds = new Set(redPlayers.map((player) => player.id));
    const normalIds = new Set(normalPlayers.map((player) => player.id));
    const finishedTopForRed = rankedFinished.slice(0, redPlayers.length);
    const finishedTopForNormal = rankedFinished.slice(0, normalPlayers.length);

    if (
      finishedTopForRed.length >= redPlayers.length &&
      finishedTopForRed.every((player) => redIds.has(player.id))
    ) {
      return {
        outcome: "red_capture",
        winner: "red",
        message: "红十方包揽前几名，普通方全被抓。",
        capturedPlayerIds: normalPlayers.map((player) => player.id)
      };
    }

    if (
      finishedTopForNormal.length >= normalPlayers.length &&
      finishedTopForNormal.every((player) => normalIds.has(player.id))
    ) {
      return {
        outcome: "normal_capture",
        winner: "normal",
        message: "普通方包揽前几名，红十方被抓。",
        capturedPlayerIds: redPlayers.map((player) => player.id)
      };
    }

    const redCanStillTakeTop = rankedFinished
      .slice(0, redPlayers.length)
      .every((player) => redIds.has(player.id));
    const normalCanStillTakeTop = rankedFinished
      .slice(0, normalPlayers.length)
      .every((player) => normalIds.has(player.id));

    if (!redCanStillTakeTop && !normalCanStillTakeTop) {
      return {
        outcome: "draw",
        winner: "none",
        message: "双方名次交错，本局平局。",
        capturedPlayerIds: []
      };
    }

    return undefined;
  }

  private finishTrickAndLead(lastPlay: PublicPlay): void {
    const lastPlayer = this.state.players.find((player) => player.id === lastPlay.playerId);
    const nextLeader =
      lastPlayer && !lastPlayer.finishRank
        ? lastPlayer
        : this.nextUnfinishedAfterSeat(lastPlayer?.seat ?? 0);

    this.state.lastPlay = undefined;
    this.state.passes = [];
    this.state.currentTurn = nextLeader?.id;
  }

  private nextResponderAfter(seat: number, lastPlayerId: string): Player | undefined {
    return this.nextUnfinishedAfterSeat(seat, (player) => {
      return player.id !== lastPlayerId && !this.state.passes.includes(player.id);
    });
  }

  private eligibleResponders(lastPlayerId: string): Player[] {
    return this.state.players.filter((player) => {
      return !player.finishRank && player.id !== lastPlayerId && !this.state.passes.includes(player.id);
    });
  }

  private nextUnfinishedAfterSeat(
    seat: number,
    predicate: (player: Player) => boolean = () => true
  ): Player | undefined {
    const activePlayers = this.state.players
      .filter((player) => !player.finishRank && predicate(player))
      .sort((left, right) => left.seat - right.seat);
    if (activePlayers.length === 0) return undefined;

    const later = activePlayers.find((player) => player.seat > seat);
    return later ?? activePlayers[0];
  }

  private requirePlayer(playerId: string): Player {
    const player = this.state.players.find((item) => item.id === playerId);
    if (!player) {
      throw new Error("你不在这个房间里。");
    }
    return player;
  }

  private sortPlayers(): void {
    this.state.players.sort((left, right) => left.seat - right.seat);
  }

  private touch(): void {
    this.state.updatedAt = Date.now();
  }

  private clearTimers(): void {
    this.clearLeadTimer();
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  private clearLeadTimer(): void {
    if (this.leadTimer) {
      clearTimeout(this.leadTimer);
      this.leadTimer = undefined;
    }
  }
}

function compareCardsForTribute(left: Card, right: Card): number {
  const valueDiff = getCardValue(left) - getCardValue(right);
  if (valueDiff !== 0) return valueDiff;
  if (left.rank === "JOKER" && right.rank === "JOKER") {
    if (left.jokerType === right.jokerType) return left.id.localeCompare(right.id);
    return left.jokerType === "big" ? 1 : -1;
  }
  return left.id.localeCompare(right.id);
}

function countJokers(cards: Card[]): number {
  return cards.filter((card) => card.rank === "JOKER").length;
}

function cleanNickname(nickname: string): string {
  const cleaned = nickname.trim().slice(0, 16);
  if (!cleaned) {
    throw new Error("请输入昵称。");
  }
  return cleaned;
}
