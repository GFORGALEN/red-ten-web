import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { io, Socket } from "socket.io-client";
import { analyzePlay, canBeat } from "../shared/rules";
import { cardShortText, getCardValue, getRankValue, sortCards } from "../shared/cards";
import type {
  Ack,
  Card,
  ClientToServerEvents,
  Play,
  RoomOptions,
  RoomView,
  ServerToClientEvents
} from "../shared/types";

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const PLAYER_ID_KEY = "red-ten-player-id";
const NICKNAME_KEY = "red-ten-nickname";

export function App() {
  const [socket, setSocket] = useState<TypedSocket | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [roomIdFromPath, setRoomIdFromPath] = useState(readRoomIdFromPath());
  const [nickname, setNickname] = useState(() => safeStorageGet(NICKNAME_KEY) ?? "");
  const [playerId] = useState(getOrCreatePlayerId);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [dockCollapsed, setDockCollapsed] = useState(() => {
    return window.matchMedia("(orientation: landscape) and (max-height: 560px)").matches;
  });

  useEffect(() => {
    const nextSocket: TypedSocket = io();
    nextSocket.on("room:state", (state) => {
      setRoom(state);
      setSelectedIds((current) => {
        const handIds = new Set(state.selfHand.map((card) => card.id));
        return current.filter((id) => handIds.has(id));
      });
      setRoomIdFromPath(state.roomId);
    });
    nextSocket.on("game:error", (payload) => setError(payload.message));
    nextSocket.on("connect_error", () => {
      setError("连接不上房间服务。手机请使用电脑局域网 IP 地址，不要用 127.0.0.1。");
    });
    setSocket(nextSocket);

    return () => {
      nextSocket.close();
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const onPopState = () => setRoomIdFromPath(readRoomIdFromPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!socket || !roomIdFromPath || !nickname.trim()) return;
    emitWithAck(
      socket,
      "room:join",
      { roomId: roomIdFromPath, playerId, nickname },
      () => undefined,
      setError
    );
  }, [socket]);

  const self = room?.players.find((player) => player.isSelf);
  const isMyTurn = Boolean(room && self && room.currentTurn === self.id);
  const hintedCards = useMemo(() => {
    if (!room) return [];
    return findPlayableHint(room.selfHand, room.lastPlay?.play);
  }, [room?.selfHand, room?.lastPlay?.play]);

  function saveNickname(value: string) {
    setNickname(value);
    safeStorageSet(NICKNAME_KEY, value);
  }

  function createRoom(options: RoomOptions) {
    if (!socket) return;
    emitWithAck(
      socket,
      "room:create",
      { playerId, nickname, options },
      (data) => {
        navigateToRoom(data.roomId);
      },
      setError
    );
  }

  function joinRoom() {
    if (!socket || !roomIdFromPath) return;
    emitWithAck(
      socket,
      "room:join",
      { roomId: roomIdFromPath, playerId, nickname },
      () => undefined,
      setError
    );
  }

  function roomAction<EventName extends "game:start" | "heart3:claimLead" | "red:reveal" | "move:pass">(
    eventName: EventName
  ) {
    if (!socket || !room) return;
    emitWithAck(
      socket,
      eventName,
      { roomId: room.roomId, playerId },
      () => undefined,
      setError
    );
  }

  function playSelectedCards() {
    if (!socket || !room) return;
    emitWithAck(
      socket,
      "move:play",
      { roomId: room.roomId, playerId, cardIds: selectedIds },
      () => setSelectedIds([]),
      setError
    );
  }

  function pickTribute(cardId: string) {
    if (!socket || !room) return;
    emitWithAck(
      socket,
      "tribute:pick",
      { roomId: room.roomId, playerId, cardId },
      () => undefined,
      setError
    );
  }

  function returnTributeCards() {
    if (!socket || !room) return;
    emitWithAck(
      socket,
      "tribute:return",
      { roomId: room.roomId, playerId, cardIds: selectedIds },
      () => setSelectedIds([]),
      setError
    );
  }

  function toggleCard(cardId: string) {
    setSelectedIds((current) => {
      if (current.includes(cardId)) {
        return current.filter((id) => id !== cardId);
      }
      return [...current, cardId];
    });
  }

  function useHint() {
    if (!hintedCards.length) {
      setError(room?.lastPlay ? "暂时找不到能压的牌。" : "手牌为空，不能提示。");
      return;
    }
    setDockCollapsed(false);
    setSelectedIds(hintedCards.map((card) => card.id));
  }

  if (!room && roomIdFromPath) {
    return (
      <Shell error={error} clearError={() => setError("")}>
        <JoinRoomPanel
          roomId={roomIdFromPath}
          nickname={nickname}
          setNickname={saveNickname}
          onJoin={joinRoom}
        />
      </Shell>
    );
  }

  if (!room) {
    return (
      <Shell error={error} clearError={() => setError("")}>
        <HomePanel nickname={nickname} setNickname={saveNickname} onCreate={createRoom} />
      </Shell>
    );
  }

  return (
    <Shell error={error} clearError={() => setError("")}>
      <main className="game-shell">
        <header className="game-topbar">
          <button className="icon-button" onClick={() => (window.location.href = "/")} aria-label="返回大厅">
            ‹
          </button>
          <div className="room-title">
            <span>房间 {room.roomId}</span>
            <strong>{phaseText(room.phase)}</strong>
          </div>
          <CopyLinkButton roomId={room.roomId} />
        </header>

        <section className="arena">
          <OpponentRail room={room} />
          <Board room={room} now={now} onPickTribute={pickTribute} />
        </section>

        <section className={`bottom-dock ${dockCollapsed ? "collapsed" : ""}`}>
          <div className="dock-head">
            {dockCollapsed && <DockSummary room={room} />}
            <button className="dock-toggle" onClick={() => setDockCollapsed((current) => !current)}>
              {dockCollapsed ? "展开手牌" : "收起"}
            </button>
          </div>
          {!dockCollapsed && <SelfStrip room={room} />}
          <ActionBar
            room={room}
            isMyTurn={isMyTurn}
            selectedCount={selectedIds.length}
            hasHint={hintedCards.length > 0}
            onStart={() => roomAction("game:start")}
            onClaimLead={() => roomAction("heart3:claimLead")}
            onReveal={() => roomAction("red:reveal")}
            onHint={useHint}
            onClear={() => setSelectedIds([])}
            onPlay={playSelectedCards}
            onPass={() => roomAction("move:pass")}
            onReturnTribute={returnTributeCards}
          />
          {!dockCollapsed && (
            <Hand
              cards={room.selfHand}
              selectedIds={selectedIds}
              onToggle={toggleCard}
              onSelectionChange={setSelectedIds}
            />
          )}
        </section>
      </main>
    </Shell>
  );
}

function Shell({
  children,
  error,
  clearError
}: {
  children: ReactNode;
  error: string;
  clearError: () => void;
}) {
  return (
    <div className="app-shell">
      {children}
      {error && (
        <button className="toast" onClick={clearError}>
          {error}
        </button>
      )}
    </div>
  );
}

function HomePanel({
  nickname,
  setNickname,
  onCreate
}: {
  nickname: string;
  setNickname: (value: string) => void;
  onCreate: (options: RoomOptions) => void;
}) {
  const [playerCount, setPlayerCount] = useState(4);
  const [deckCount, setDeckCount] = useState(2);

  return (
    <main className="home-panel">
      <section className="home-card">
        <p className="eyebrow">无需登录 · 发链接进房间</p>
        <h1>红十</h1>
        <label>
          昵称
          <input value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={16} />
        </label>
        <div className="settings-grid">
          <label>
            人数
            <input
              type="number"
              min={2}
              max={10}
              value={playerCount}
              onChange={(event) => setPlayerCount(Number(event.target.value))}
            />
          </label>
          <label>
            牌副数
            <input
              type="number"
              min={1}
              max={6}
              value={deckCount}
              onChange={(event) => setDeckCount(Number(event.target.value))}
            />
          </label>
        </div>
        <button
          className="gold-button wide"
          disabled={!nickname.trim()}
          onClick={() => onCreate({ playerCount, deckCount })}
        >
          创建房间
        </button>
      </section>
    </main>
  );
}

function JoinRoomPanel({
  roomId,
  nickname,
  setNickname,
  onJoin
}: {
  roomId: string;
  nickname: string;
  setNickname: (value: string) => void;
  onJoin: () => void;
}) {
  return (
    <main className="home-panel">
      <section className="home-card">
        <p className="eyebrow">加入房间 {roomId}</p>
        <h1>准备入座</h1>
        <label>
          昵称
          <input value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={16} />
        </label>
        <button className="gold-button wide" disabled={!nickname.trim()} onClick={onJoin}>
          加入房间
        </button>
        <button className="plain-button wide" onClick={() => (window.location.href = "/")}>
          返回大厅
        </button>
      </section>
    </main>
  );
}

function OpponentRail({ room }: { room: RoomView }) {
  const players = room.players.filter((player) => !player.isSelf);

  return (
    <div className="opponent-rail" style={{ ["--opponent-count" as string]: Math.max(players.length, 1) }}>
      {players.map((player) => (
        <PlayerBadge room={room} player={player} key={player.id} />
      ))}
    </div>
  );
}

function PlayerBadge({ room, player }: { room: RoomView; player: RoomView["players"][number] }) {
  const isCurrent = player.id === room.currentTurn;

  return (
    <div className={`player-badge ${isCurrent ? "current" : ""} ${!player.isConnected ? "offline" : ""}`}>
      <div className="avatar">{player.nickname.slice(0, 1).toUpperCase()}</div>
      <div className="player-copy">
        <strong>{player.nickname}</strong>
        <span>
          {player.cardCount} 张{player.finishRank ? ` · 第 ${player.finishRank}` : ""}
        </span>
      </div>
      <div className="badge-tags">
        {player.isHost && <span>房主</span>}
        {player.isRedTeam === true && <span className="red">红十</span>}
        {!player.isConnected && <span>离线</span>}
      </div>
    </div>
  );
}

function Board({
  room,
  now,
  onPickTribute
}: {
  room: RoomView;
  now: number;
  onPickTribute: (cardId: string) => void;
}) {
  const currentPlayer = room.players.find((player) => player.id === room.currentTurn);
  const tributePicker = room.players.find((player) => player.id === room.tribute?.currentPickerId);
  const tributeReturner = room.players.find((player) => player.id === room.tribute?.currentReturnerId);

  return (
    <div className="table-stage">
      <div className="turn-banner">
        {room.phase === "lobby" && "等待玩家入座"}
        {room.phase === "claimLead" && `等待红桃3首出确认${deadlineText(room.leadClaim?.deadline, now)}`}
        {room.phase === "playing" && (currentPlayer ? `轮到 ${currentPlayer.nickname}` : "准备下一轮")}
        {room.phase === "tribute" &&
          (tributePicker
            ? `进贡：${tributePicker.nickname} 选贡牌`
            : tributeReturner
              ? `进贡：${tributeReturner.nickname} 返牌`
              : "进贡处理中")}
        {room.phase === "finished" && room.result?.message}
      </div>

      <div className="last-play-stage">
        {room.phase === "tribute" && room.tribute ? (
          <div className="tribute-panel">
            <div className="play-caption">
              <span>贡牌池</span>
              <strong>
                {room.canPickTribute ? "点一张贡牌收入手牌" : room.canReturnTribute ? "从手牌选择返还牌" : "等待其他玩家操作"}
              </strong>
            </div>
            <div className="played-cards tribute-cards">
              {room.tribute.pool.map((pick) => (
                <button
                  className="tribute-card-button"
                  disabled={!room.canPickTribute}
                  key={pick.card.id}
                  onClick={() => onPickTribute(pick.card.id)}
                >
                  <CardFace card={pick.card} compact />
                </button>
              ))}
            </div>
          </div>
        ) : room.lastPlay ? (
          <>
            <div className="play-caption">
              <span>桌面最大</span>
              <strong>
                {room.lastPlay.playerName} · {room.lastPlay.play.label}
              </strong>
            </div>
            <PlayedCards cards={room.lastPlay.cards} />
          </>
        ) : (
          <div className="empty-trick">
            <span>新一轮</span>
            <strong>等待首出</strong>
          </div>
        )}
      </div>

      {room.phase === "finished" && room.result && (
        <div className="result-panel">
          <strong>{room.result.winner === "red" ? "红十方胜" : room.result.winner === "normal" ? "普通方胜" : "平局"}</strong>
          <span>{room.result.message}</span>
        </div>
      )}
    </div>
  );
}

function PlayedCards({ cards }: { cards: Card[] }) {
  return (
    <div className="played-cards">
      {cards.map((card) => (
        <CardFace card={card} key={card.id} compact />
      ))}
    </div>
  );
}

function SelfStrip({ room }: { room: RoomView }) {
  const self = room.players.find((player) => player.isSelf);
  if (!self) return null;

  return (
    <div className="self-strip">
      <div className="avatar self">{self.nickname.slice(0, 1).toUpperCase()}</div>
      <div>
        <strong>{self.nickname}</strong>
        <span>
          手牌 {self.cardCount} 张
          {self.isRedTeam === true ? " · 红十方" : ""}
          {self.finishRank ? ` · 第 ${self.finishRank} 名` : ""}
        </span>
      </div>
    </div>
  );
}

function DockSummary({ room }: { room: RoomView }) {
  const self = room.players.find((player) => player.isSelf);
  if (!self) return null;

  return (
    <div className="dock-summary">
      <strong>{self.nickname}</strong>
      <span>手牌 {self.cardCount} 张</span>
    </div>
  );
}

function ActionBar({
  room,
  isMyTurn,
  selectedCount,
  hasHint,
  onStart,
  onClaimLead,
  onReveal,
  onHint,
  onClear,
  onPlay,
  onPass,
  onReturnTribute
}: {
  room: RoomView;
  isMyTurn: boolean;
  selectedCount: number;
  hasHint: boolean;
  onStart: () => void;
  onClaimLead: () => void;
  onReveal: () => void;
  onHint: () => void;
  onClear: () => void;
  onPlay: () => void;
  onPass: () => void;
  onReturnTribute: () => void;
}) {
  const self = room.players.find((player) => player.isSelf);

  return (
    <div className="action-bar">
      {room.phase === "lobby" && self?.isHost && (
        <button className="gold-button" disabled={room.players.length !== room.options.playerCount} onClick={onStart}>
          开始游戏
        </button>
      )}
      {room.phase === "claimLead" && room.canClaimLead && (
        <button className="gold-button" onClick={onClaimLead}>
          抢首出
        </button>
      )}
      {self?.isRedTeam && !self.isRevealed && room.phase === "playing" && (
        <button className="plain-button" onClick={onReveal}>
          亮红十
        </button>
      )}
      {room.phase === "playing" && (
        <>
          {selectedCount > 0 && <span className="selected-count">已选 {selectedCount}</span>}
          <button className="plain-button" disabled={!isMyTurn || !hasHint} onClick={onHint}>
            提示
          </button>
          <button className="plain-button" disabled={selectedCount === 0} onClick={onClear}>
            重选
          </button>
          <button className="gold-button" disabled={!isMyTurn || selectedCount === 0} onClick={onPlay}>
            出牌
          </button>
          <button className="pass-button" disabled={!isMyTurn || !room.lastPlay} onClick={onPass}>
            过
          </button>
        </>
      )}
      {room.phase === "tribute" && (
        <>
          {selectedCount > 0 && <span className="selected-count">已选 {selectedCount}</span>}
          <button className="plain-button" disabled={selectedCount === 0} onClick={onClear}>
            重选
          </button>
          <button className="gold-button" disabled={!room.canReturnTribute || selectedCount === 0} onClick={onReturnTribute}>
            返牌
          </button>
        </>
      )}
      {room.phase === "finished" && self?.isHost && (
        <button className="gold-button" onClick={onStart}>
          再来一局
        </button>
      )}
    </div>
  );
}

function Hand({
  cards,
  selectedIds,
  onToggle,
  onSelectionChange
}: {
  cards: Card[];
  selectedIds: string[];
  onToggle: (cardId: string) => void;
  onSelectionChange: (cardIds: string[]) => void;
}) {
  const dragRef = useRef<{
    startIndex: number;
    lastIndex: number;
    shouldSelect: boolean;
    baseSelection: Set<string>;
  } | null>(null);

  function cardIndexFromPoint(clientX: number, clientY: number): number | null {
    const element = document.elementFromPoint(clientX, clientY);
    const cardElement = element?.closest("[data-card-index]");
    if (!(cardElement instanceof HTMLElement)) return null;

    const index = Number(cardElement.dataset.cardIndex);
    return Number.isFinite(index) ? index : null;
  }

  function applyDragSelection(toIndex: number) {
    const drag = dragRef.current;
    if (!drag) return;

    drag.lastIndex = toIndex;
    const [from, to] = [drag.startIndex, toIndex].sort((left, right) => left - right);
    const nextSelection = new Set(drag.baseSelection);

    for (let index = from; index <= to; index += 1) {
      const cardId = cards[index]?.id;
      if (!cardId) continue;
      if (drag.shouldSelect) {
        nextSelection.add(cardId);
      } else {
        nextSelection.delete(cardId);
      }
    }

    onSelectionChange(cards.filter((card) => nextSelection.has(card.id)).map((card) => card.id));
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    dragRef.current = {
      startIndex: index,
      lastIndex: index,
      shouldSelect: !selectedIds.includes(cards[index].id),
      baseSelection: new Set(selectedIds)
    };
    applyDragSelection(index);
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!dragRef.current) return;
    event.preventDefault();

    const index = cardIndexFromPoint(event.clientX, event.clientY);
    if (index === null || index === dragRef.current.lastIndex) return;
    applyDragSelection(index);
  }

  function handlePointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (!dragRef.current) return;
    event.preventDefault();
    dragRef.current = null;
  }

  return (
    <div className="hand-scroll" aria-label="我的手牌">
      <div className="hand-fan" style={{ ["--card-count" as string]: cards.length }}>
        {cards.map((card, index) => (
          <button
            className={`card-button ${selectedIds.includes(card.id) ? "selected" : ""}`}
            key={card.id}
            data-card-index={index}
            onPointerDown={(event) => handlePointerDown(event, index)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onClick={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onToggle(card.id);
              }
            }}
            style={{ zIndex: index }}
            aria-label={`选择 ${cardShortText(card)}`}
          >
            <CardFace card={card} />
          </button>
        ))}
      </div>
    </div>
  );
}

function CardFace({ card, compact = false }: { card: Card; compact?: boolean }) {
  const isRed = card.suit === "hearts" || card.suit === "diamonds";
  const isJoker = card.rank === "JOKER";
  const suit = suitMark(card);

  return (
    <span className={`card-face ${compact ? "compact" : ""} ${isRed ? "red" : ""} ${isJoker ? "joker" : ""}`}>
      <span className="card-corner">
        <b>{isJoker ? (card.jokerType === "big" ? "大" : "小") : card.rank}</b>
        <i>{isJoker ? "王" : suit}</i>
      </span>
      <span className="card-center">{isJoker ? "JOKER" : suit}</span>
    </span>
  );
}

function CopyLinkButton({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/room/${roomId}`;

  return (
    <button
      className="plain-button small"
      onClick={async () => {
        await copyText(link);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? "已复制" : "复制链接"}
    </button>
  );
}

function findPlayableHint(hand: Card[], current?: Play): Card[] {
  const sortedHand = sortCards(hand);
  const candidates: { cards: Card[]; play: Play; priority: number }[] = [];

  const addCandidate = (cards: Card[], priority: number) => {
    try {
      const play = analyzePlay(cards);
      if (canBeat(play, current)) {
        candidates.push({ cards: play.cards, play, priority });
      }
    } catch {
      // Ignore invalid generated combinations.
    }
  };

  if (!current) {
    return sortedHand.slice(0, 1);
  }

  const rankGroups = groupRegularCards(sortedHand);

  if (current.type === "single") {
    sortedHand.forEach((card) => addCandidate([card], 1));
  }

  if (current.type === "pair") {
    rankGroups.forEach((group) => {
      if (group.cards.length >= 2) addCandidate(group.cards.slice(0, 2), 1);
    });
  }

  if (current.type === "straight") {
    generateSequences(rankGroups, current.length, 1).forEach((cards) => addCandidate(cards, 1));
  }

  if (current.type === "consecutive_pairs") {
    generateSequences(rankGroups, current.length / 2, 2).forEach((cards) => addCandidate(cards, 1));
  }

  if (current.type === "triple_sequence") {
    generateSequences(rankGroups, current.length / 3, 3).forEach((cards) => addCandidate(cards, 1));
  }

  rankGroups.forEach((group) => {
    if (group.cards.length < 3) return;
    for (let size = 3; size <= group.cards.length; size += 1) {
      addCandidate(group.cards.slice(0, size), current.type === "bomb" ? 1 : 2);
    }
  });

  const jokers = sortedHand.filter((card) => card.rank === "JOKER");
  for (let size = 2; size <= jokers.length; size += 1) {
    addCandidate(jokers.slice(0, size), current.type === "bomb" ? 1 : 2);
  }

  candidates.sort((left, right) => {
    const priorityDiff = left.priority - right.priority;
    if (priorityDiff !== 0) return priorityDiff;
    const powerDiff = (left.play.bombPower ?? 0) - (right.play.bombPower ?? 0);
    if (powerDiff !== 0) return powerDiff;
    const lengthDiff = left.cards.length - right.cards.length;
    if (lengthDiff !== 0) return lengthDiff;
    return left.play.rankValue - right.play.rankValue;
  });

  return candidates[0]?.cards ?? [];
}

function groupRegularCards(cards: Card[]) {
  const groups = new Map<string, Card[]>();
  for (const card of cards) {
    if (card.rank === "JOKER") continue;
    const value = getRankValue(card.rank);
    if (value < 3 || value > 14) continue;
    groups.set(card.rank, [...(groups.get(card.rank) ?? []), card]);
  }

  return Array.from(groups.entries())
    .map(([rank, groupCards]) => ({
      rank,
      value: getCardValue(groupCards[0]),
      cards: sortCards(groupCards)
    }))
    .sort((left, right) => left.value - right.value);
}

function generateSequences(
  groups: ReturnType<typeof groupRegularCards>,
  neededGroupCount: number,
  cardsPerGroup: 1 | 2 | 3
): Card[][] {
  const available = groups.filter((group) => group.cards.length >= cardsPerGroup);
  const sequences: Card[][] = [];

  for (let start = 0; start <= available.length - neededGroupCount; start += 1) {
    const slice = available.slice(start, start + neededGroupCount);
    const isContinuous = slice.every((group, index) => {
      return index === 0 || group.value === slice[index - 1].value + 1;
    });
    if (!isContinuous) continue;
    sequences.push(slice.flatMap((group) => group.cards.slice(0, cardsPerGroup)));
  }

  return sequences;
}

function emitWithAck<EventName extends keyof ClientToServerEvents>(
  socket: TypedSocket,
  eventName: EventName,
  payload: Parameters<ClientToServerEvents[EventName]>[0],
  onSuccess: (data: ExtractAckData<Parameters<ClientToServerEvents[EventName]>[1]>) => void,
  onError: (message: string) => void
) {
  const emit = socket.emit.bind(socket) as (
    event: string,
    payload: unknown,
    ack: (response: Ack<unknown>) => void
  ) => void;

  emit(String(eventName), payload, (response: Ack<unknown>) => {
    if (response.ok) {
      onSuccess(response.data as never);
    } else {
      onError(response.error);
    }
  });
}

type ExtractAckData<T> = T extends (response: Ack<infer Data>) => void ? Data : never;

function getOrCreatePlayerId(): string {
  const existing = safeStorageGet(PLAYER_ID_KEY);
  if (existing) return existing;
  const next = createPlayerId();
  safeStorageSet(PLAYER_ID_KEY, next);
  return next;
}

function createPlayerId(): string {
  const browserCrypto = globalThis.crypto as Crypto | undefined;
  const cryptoWithUuid = browserCrypto as (Crypto & { randomUUID?: () => string }) | undefined;

  if (cryptoWithUuid?.randomUUID) {
    return cryptoWithUuid.randomUUID();
  }

  if (browserCrypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    browserCrypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `player-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Some mobile in-app browsers block localStorage. The game can still work for this session.
  }
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function readRoomIdFromPath(): string {
  const match = window.location.pathname.match(/^\/room\/([A-Z0-9]+)$/i);
  return match?.[1]?.toUpperCase() ?? "";
}

function navigateToRoom(roomId: string) {
  window.history.pushState({}, "", `/room/${roomId}`);
}

function phaseText(phase: RoomView["phase"]): string {
  const text = {
    lobby: "等待中",
    claimLead: "抢首出",
    tribute: "进贡",
    playing: "游戏中",
    finished: "已结束"
  };
  return text[phase];
}

function deadlineText(deadline: number | undefined, now: number): string {
  if (!deadline) return "";
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  return ` · ${seconds}s`;
}

function suitMark(card: Card): string {
  if (card.rank === "JOKER") return "";
  const marks = {
    spades: "♠",
    hearts: "♥",
    clubs: "♣",
    diamonds: "♦"
  };
  return marks[card.suit!];
}
