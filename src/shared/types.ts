export type Suit = "spades" | "hearts" | "clubs" | "diamonds";
export type Rank =
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "A"
  | "2"
  | "JOKER";
export type JokerType = "small" | "big";

export interface RoomOptions {
  playerCount: number;
  deckCount: number;
}

export interface Card {
  id: string;
  deckId: number;
  suit?: Suit;
  rank: Rank;
  jokerType?: JokerType;
}

export type PlayType =
  | "single"
  | "pair"
  | "straight"
  | "consecutive_pairs"
  | "triple_sequence"
  | "bomb";

export interface Play {
  cards: Card[];
  type: PlayType;
  rankValue: number;
  length: number;
  bombPower?: number;
  isJokerBomb?: boolean;
  label: string;
}

export interface PublicPlay {
  playerId: string;
  playerName: string;
  cards: Card[];
  play: Play;
  createdAt: number;
}

export type GamePhase = "lobby" | "claimLead" | "tribute" | "playing" | "finished";

export interface Player {
  id: string;
  nickname: string;
  seat: number;
  hand: Card[];
  isRedTeam: boolean;
  isRevealed: boolean;
  finishRank?: number;
}

export interface GameResult {
  outcome: "red_capture" | "normal_capture" | "draw";
  winner: "red" | "normal" | "none";
  message: string;
  capturedPlayerIds: string[];
}

export interface TributePick {
  winnerId: string;
  fromPlayerId: string;
  card: Card;
}

export interface TributeState {
  winnerIds: string[];
  capturedPlayerIds: string[];
  leaderPlayerId?: string;
  pool: TributePick[];
  picks: TributePick[];
  returnCounts: Record<string, number>;
  returnedCounts: Record<string, number>;
  currentPickerId?: string;
  currentReturnerId?: string;
  nextLeadPlayerId?: string;
}

export interface LeadClaimState {
  candidatePlayerIds: string[];
  deadline: number;
}

export interface GameState {
  roomId: string;
  options: RoomOptions;
  phase: GamePhase;
  hostId: string;
  players: Player[];
  currentTurn?: string;
  lastPlay?: PublicPlay;
  passes: string[];
  finishOrder: string[];
  result?: GameResult;
  leadClaim?: LeadClaimState;
  tribute?: TributeState;
  createdAt: number;
  updatedAt: number;
}

export interface PlayerView {
  id: string;
  nickname: string;
  seat: number;
  cardCount: number;
  isConnected: boolean;
  isHost: boolean;
  isSelf: boolean;
  isRevealed: boolean;
  isRedTeam?: boolean;
  finishRank?: number;
}

export interface RoomView {
  roomId: string;
  options: RoomOptions;
  phase: GamePhase;
  hostId: string;
  selfPlayerId: string;
  selfHand: Card[];
  players: PlayerView[];
  currentTurn?: string;
  lastPlay?: PublicPlay;
  passes: string[];
  finishOrder: string[];
  result?: GameResult;
  leadClaim?: LeadClaimState;
  tribute?: TributeState;
  canClaimLead: boolean;
  canPickTribute: boolean;
  canReturnTribute: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateRoomPayload {
  playerId: string;
  nickname: string;
  options: RoomOptions;
}

export interface JoinRoomPayload {
  roomId: string;
  playerId: string;
  nickname: string;
}

export interface RoomActionPayload {
  roomId: string;
  playerId: string;
}

export interface PlayMovePayload extends RoomActionPayload {
  cardIds: string[];
}

export interface TributePickPayload extends RoomActionPayload {
  cardId: string;
}

export interface TributeReturnPayload extends RoomActionPayload {
  cardIds: string[];
}

export type Ack<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
    };

export interface ClientToServerEvents {
  "room:create": (
    payload: CreateRoomPayload,
    ack: (response: Ack<{ roomId: string }>) => void
  ) => void;
  "room:join": (
    payload: JoinRoomPayload,
    ack: (response: Ack<{ roomId: string }>) => void
  ) => void;
  "game:start": (
    payload: RoomActionPayload,
    ack: (response: Ack<{ started: true }>) => void
  ) => void;
  "heart3:claimLead": (
    payload: RoomActionPayload,
    ack: (response: Ack<{ claimed: true }>) => void
  ) => void;
  "red:reveal": (
    payload: RoomActionPayload,
    ack: (response: Ack<{ revealed: true }>) => void
  ) => void;
  "move:play": (
    payload: PlayMovePayload,
    ack: (response: Ack<{ accepted: true }>) => void
  ) => void;
  "move:pass": (
    payload: RoomActionPayload,
    ack: (response: Ack<{ accepted: true }>) => void
  ) => void;
  "tribute:pick": (
    payload: TributePickPayload,
    ack: (response: Ack<{ accepted: true }>) => void
  ) => void;
  "tribute:return": (
    payload: TributeReturnPayload,
    ack: (response: Ack<{ accepted: true }>) => void
  ) => void;
}

export interface ServerToClientEvents {
  "room:state": (state: RoomView) => void;
  "game:error": (error: { message: string }) => void;
  "game:started": (state: RoomView) => void;
  "move:accepted": (state: RoomView) => void;
  "game:finished": (state: RoomView) => void;
}
