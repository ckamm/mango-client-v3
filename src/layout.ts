import {
  blob,
  Blob,
  greedy,
  Layout,
  nu64,
  seq,
  struct,
  Structure,
  u16,
  u32,
  u8,
  UInt,
  union,
} from 'buffer-layout';
import { PublicKey } from '@solana/web3.js';
import { I80F48 } from './fixednum';
import BN from 'bn.js';
import { zeroKey } from './utils';
import PerpAccount from './PerpAccount';

export const MAX_TOKENS = 16;
export const MAX_PAIRS = MAX_TOKENS - 1;
export const MAX_NODE_BANKS = 8;
export const INFO_LEN = 32;
export const QUOTE_INDEX = MAX_TOKENS - 1;
export const MAX_NUM_IN_MARGIN_BASKET = 10;
export const MAX_PERP_OPEN_ORDERS = 64;
export const FREE_ORDER_SLOT = 255; // u8::MAX

const MAX_BOOK_NODES = 1024;
class _I80F48Layout extends Blob {
  constructor(property: string) {
    super(16, property);
  }

  decode(b, offset) {
    let result = new BN(super.decode(b, offset), 10, 'le');
    result = result.fromTwos(8 * this['length']);
    return new I80F48(result);
  }

  encode(src, b, offset) {
    src = src.toTwos(8 * this['length']);
    return super.encode(src.toArrayLike(Buffer, 'le', this['span']), b, offset);
  }
}

export function I80F48Layout(property = '') {
  return new _I80F48Layout(property);
}

class BNLayout extends Blob {
  signed: boolean;

  constructor(number: number, property, signed = false) {
    super(number, property);
    this.signed = signed;

    // restore prototype chain
    Object.setPrototypeOf(this, new.target.prototype);
  }

  decode(b, offset) {
    let result = new BN(super.decode(b, offset), 10, 'le');
    if (this.signed) result = result.fromTwos(8 * this['length']);
    return result;
  }

  encode(src, b, offset) {
    if (this.signed) src = src.toTwos(8 * this['length']);
    return super.encode(src.toArrayLike(Buffer, 'le', this['span']), b, offset);
  }
}

export function u64(property = '') {
  return new BNLayout(8, property);
}

export function i64(property = '') {
  return new BNLayout(8, property, true);
}

export function u128(property?: string) {
  return new BNLayout(16, property);
}

export function i128(property?: string) {
  return new BNLayout(16, property, true);
}

class WrappedLayout<T, U> extends Layout<U> {
  layout: Layout<T>;
  decoder: (data: T) => U;
  encoder: (src: U) => T;

  constructor(
    layout: Layout<T>,
    decoder: (data: T) => U,
    encoder: (src: U) => T,
    property?: string,
  ) {
    super(layout.span, property);
    this.layout = layout;
    this.decoder = decoder;
    this.encoder = encoder;
  }

  decode(b: Buffer, offset?: number): U {
    return this.decoder(this.layout.decode(b, offset));
  }

  encode(src: U, b: Buffer, offset?: number): number {
    return this.layout.encode(this.encoder(src), b, offset);
  }

  getSpan(b: Buffer, offset?: number): number {
    return this.layout.getSpan(b, offset);
  }
}

export function bool(property?: string) {
  return new WrappedLayout(u8(), decodeBool, encodeBool, property);
}

function decodeBool(value: number): boolean {
  if (value === 0) {
    return false;
  } else if (value === 1) {
    return true;
  }
  throw new Error('Invalid bool: ' + value);
}

function encodeBool(value: boolean): number {
  return value ? 1 : 0;
}

class EnumLayout extends UInt {
  values: any;
  constructor(values, span, property?) {
    super(span, property);
    this.values = values;
  }
  encode(src, b, offset) {
    if (this.values[src] !== undefined) {
      return super.encode(this.values[src], b, offset);
    }
    throw new Error('Invalid ' + this['property']);
  }

  decode(b, offset) {
    const decodedValue = super.decode(b, offset);
    const entry = Object.entries(this.values).find(
      ([, value]) => value === decodedValue,
    );
    if (entry) {
      return entry[0];
    }
    throw new Error('Invalid ' + this['property']);
  }
}

export function sideLayout(span, property?) {
  return new EnumLayout({ buy: 0, sell: 1 }, span, property);
}

export function orderTypeLayout(property, span) {
  return new EnumLayout({ limit: 0, ioc: 1, postOnly: 2 }, span, property);
}

export function selfTradeBehaviorLayout(property) {
  return new EnumLayout(
    { decrementTake: 0, cancelProvide: 1, abortTransaction: 2 },
    4,
    property,
  );
}

/**
 * Need to implement layouts for each of the structs found in state.rs
 */
export const MangoInstructionLayout = union(u32('instruction'));
MangoInstructionLayout.addVariant(
  0,
  struct([
    u64('signerNonce'),
    u64('validInterval'),
    I80F48Layout('quoteOptimalUtil'),
    I80F48Layout('quoteOptimalRate'),
    I80F48Layout('quoteMaxRate'),
  ]),
  'InitMangoGroup',
);
MangoInstructionLayout.addVariant(1, struct([]), 'InitMangoAccount');
MangoInstructionLayout.addVariant(2, struct([u64('quantity')]), 'Deposit');
MangoInstructionLayout.addVariant(
  3,
  struct([u64('quantity'), u8('allowBorrow')]),
  'Withdraw',
);
MangoInstructionLayout.addVariant(
  4,
  struct([
    u64('marketIndex'),
    I80F48Layout('maintLeverage'),
    I80F48Layout('initLeverage'),
    I80F48Layout('liquidationFee'),
    I80F48Layout('optimalUtil'),
    I80F48Layout('optimalRate'),
    I80F48Layout('maxRate'),
  ]),
  'AddSpotMarket',
);
MangoInstructionLayout.addVariant(
  5,
  struct([u64('marketIndex')]),
  'AddToBasket',
);
MangoInstructionLayout.addVariant(6, struct([u64('quantity')]), 'Borrow');
MangoInstructionLayout.addVariant(7, struct([]), 'CachePrices');
MangoInstructionLayout.addVariant(8, struct([]), 'CacheRootBanks');
MangoInstructionLayout.addVariant(
  9,
  struct([
    sideLayout(4, 'side'),
    u64('limitPrice'),
    u64('maxBaseQuantity'),
    u64('maxQuoteQuantity'),
    selfTradeBehaviorLayout('selfTradeBehavior'),
    orderTypeLayout('orderType', 4),
    u64('clientId'),
    u16('limit'),
  ]),
  'PlaceSpotOrder',
);
MangoInstructionLayout.addVariant(10, struct([]), 'AddOracle');
MangoInstructionLayout.addVariant(
  11,
  struct([
    u64('marketIndex'),
    I80F48Layout('maintLeverage'),
    I80F48Layout('initLeverage'),
    I80F48Layout('liquidationFee'),
    I80F48Layout('makerFee'),
    I80F48Layout('takerFee'),
    i64('baseLotSize'),
    i64('quoteLotSize'),
    I80F48Layout('rate'),
    I80F48Layout('maxDepthBps'),
    u64('targetPeriodLength'),
    u64('mngoPerPeriod'),
  ]),
  'AddPerpMarket',
);
MangoInstructionLayout.addVariant(
  12,
  struct([
    i64('price'),
    i64('quantity'),
    u64('clientOrderId'),
    sideLayout(1, 'side'),
    orderTypeLayout('orderType', 1),
  ]),
  'PlacePerpOrder',
);
MangoInstructionLayout.addVariant(
  13,
  struct([u64('clientOrderId'), bool('invalidIdOk')]),
  'CancelPerpOrderByClientId',
);
MangoInstructionLayout.addVariant(
  14,
  struct([i128('orderId'), bool('invalidIdOk')]),
  'CancelPerpOrder',
);
MangoInstructionLayout.addVariant(15, struct([u64('limit')]), 'ConsumeEvents');
MangoInstructionLayout.addVariant(16, struct([]), 'CachePerpMarkets');
MangoInstructionLayout.addVariant(17, struct([]), 'UpdateFunding');
MangoInstructionLayout.addVariant(
  18,
  struct([I80F48Layout('price')]),
  'SetOracle',
);
MangoInstructionLayout.addVariant(19, struct([]), 'SettleFunds');
MangoInstructionLayout.addVariant(
  20,
  struct([sideLayout(4, 'side'), u128('orderId')]),
  'CancelSpotOrder',
);
MangoInstructionLayout.addVariant(21, struct([]), 'UpdateRootBank');
MangoInstructionLayout.addVariant(
  22,
  struct([u64('marketIndex')]),
  'SettlePnl',
);
MangoInstructionLayout.addVariant(
  23,
  struct([u64('tokenIndex'), u64('quantity')]),
  'SettleBorrow',
);
MangoInstructionLayout.addVariant(
  24,
  struct([u8('limit')]),
  'ForceCancelSpotOrders',
);
MangoInstructionLayout.addVariant(
  25,
  struct([u8('limit')]),
  'ForceCancelPerpOrders',
);
MangoInstructionLayout.addVariant(
  26,
  struct([I80F48Layout('maxLiabTransfer')]),
  'LiquidateTokenAndToken',
);
MangoInstructionLayout.addVariant(
  27,
  struct([
    u8('assetType'),
    u64('assetIndex'),
    u8('liabType'),
    u64('liabIndex'),
    I80F48Layout('maxLiabTransfer'),
  ]),
  'LiquidateTokenAndPerp',
);
MangoInstructionLayout.addVariant(
  28,
  struct([i64('baseTransferRequest')]),
  'LiquidatePerpMarket',
);
MangoInstructionLayout.addVariant(29, struct([]), 'SettleFees');
MangoInstructionLayout.addVariant(
  30,
  struct([u64('liabIndex'), I80F48Layout('maxLiabTransfer')]),
  'ResolvePerpBankruptcy',
);
MangoInstructionLayout.addVariant(
  31,
  struct([I80F48Layout('maxLiabTransfer')]),
  'ResolveTokenBankruptcy',
);
MangoInstructionLayout.addVariant(32, struct([]), 'InitSpotOpenOrders');
MangoInstructionLayout.addVariant(33, struct([]), 'RedeemMngo');
MangoInstructionLayout.addVariant(
  34,
  struct([seq(u8(), INFO_LEN, 'info')]),
  'AddMangoAccountInfo',
);
MangoInstructionLayout.addVariant(35, struct([u64('quantity')]), 'DepositMsrm');
MangoInstructionLayout.addVariant(
  36,
  struct([u64('quantity')]),
  'WithdrawMsrm',
);
MangoInstructionLayout.addVariant(
  37,
  struct([
    bool('maintLeverageOption'),
    I80F48Layout('maintLeverage'),
    bool('initLeverageOption'),
    I80F48Layout('initLeverage'),
    bool('liquidationFeeOption'),
    I80F48Layout('liquidationFee'),
    bool('makerFeeOption'),
    I80F48Layout('makerFee'),
    bool('takerFeeOption'),
    I80F48Layout('takerFee'),
    bool('rateOption'),
    I80F48Layout('rate'),
    bool('maxDepthBpsOption'),
    I80F48Layout('maxDepthBps'),
    bool('targetPeriodLengthOption'),
    u64('targetPeriodLength'),
    bool('mngoPerPeriodOption'),
    u64('mngoPerPeriod'),
  ]),
  'ChangePerpMarketParams',
);
MangoInstructionLayout.addVariant(38, struct([]), 'SetGroupAdmin');
MangoInstructionLayout.addVariant(
  39,
  struct([u8('limit')]),
  'CancelAllPerpOrders',
);
MangoInstructionLayout.addVariant(40, struct([]), 'ForceSettleQuotePositions');

const instructionMaxSpan = Math.max(
  // @ts-ignore
  ...Object.values(MangoInstructionLayout.registry).map((r) => r.span),
);
export function encodeMangoInstruction(data) {
  const b = Buffer.alloc(instructionMaxSpan);
  const span = MangoInstructionLayout.encode(data, b);
  return b.slice(0, span);
}

export class PublicKeyLayout extends Blob {
  constructor(property) {
    super(32, property);
  }

  decode(b, offset) {
    return new PublicKey(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}
export function publicKeyLayout(property = '') {
  return new PublicKeyLayout(property);
}

export const DataType = {
  MangoGroup: 0,
  MangoAccount: 1,
  RootBank: 2,
  NodeBank: 3,
  PerpMarket: 4,
  Bids: 5,
  Asks: 6,
  MangoCache: 7,
  EventQueue: 8,
};

export const enum AssetType {
  Token = 0,
  Perp = 1,
}

export class MetaData {
  dataType!: number;
  version!: number;
  isInitialized!: boolean;

  constructor(decoded: any) {
    Object.assign(this, decoded);
  }
}

export class MetaDataLayout extends Structure {
  constructor(property) {
    super(
      [
        u8('dataType'),
        u8('version'),
        u8('isInitialized'),
        seq(u8(), 5, 'padding'),
      ],
      property,
    );
  }

  decode(b, offset) {
    return new MetaData(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}
export function metaDataLayout(property = '') {
  return new MetaDataLayout(property);
}

export class TokenInfo {
  mint!: PublicKey;
  rootBank!: PublicKey;
  decimals!: number;
  padding!: number[];

  constructor(decoded: any) {
    Object.assign(this, decoded);
  }
  isEmpty(): boolean {
    return this.mint.equals(zeroKey);
  }
}

export class TokenInfoLayout extends Structure {
  constructor(property) {
    super(
      [
        publicKeyLayout('mint'),
        publicKeyLayout('rootBank'),
        u8('decimals'),
        seq(u8(), 7, 'padding'),
      ],
      property,
    );
  }

  decode(b, offset) {
    return new TokenInfo(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}

export function tokenInfoLayout(property = '') {
  return new TokenInfoLayout(property);
}

export class SpotMarketInfo {
  spotMarket!: PublicKey;
  maintAssetWeight!: I80F48;
  initAssetWeight!: I80F48;
  maintLiabWeight!: I80F48;
  initLiabWeight!: I80F48;
  liquidationFee!: I80F48;

  constructor(decoded: any) {
    Object.assign(this, decoded);
  }

  isEmpty(): boolean {
    return this.spotMarket.equals(zeroKey);
  }
}

export class SpotMarketInfoLayout extends Structure {
  constructor(property) {
    super(
      [
        publicKeyLayout('spotMarket'),
        I80F48Layout('maintAssetWeight'),
        I80F48Layout('initAssetWeight'),
        I80F48Layout('maintLiabWeight'),
        I80F48Layout('initLiabWeight'),
        I80F48Layout('liquidationFee'),
      ],
      property,
    );
  }

  decode(b, offset) {
    return new SpotMarketInfo(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}

export function spotMarketInfoLayout(property = '') {
  return new SpotMarketInfoLayout(property);
}

export class PerpMarketInfo {
  perpMarket!: PublicKey;
  maintAssetWeight!: I80F48;
  initAssetWeight!: I80F48;
  maintLiabWeight!: I80F48;
  initLiabWeight!: I80F48;
  liquidationFee!: I80F48;
  makerFee!: I80F48;
  takerFee!: I80F48;
  baseLotSize!: BN;
  quoteLotSize!: BN;

  constructor(decoded: any) {
    Object.assign(this, decoded);
  }
  isEmpty(): boolean {
    return this.perpMarket.equals(zeroKey);
  }
}

export class PerpMarketInfoLayout extends Structure {
  constructor(property) {
    super(
      [
        publicKeyLayout('perpMarket'),
        I80F48Layout('maintAssetWeight'),
        I80F48Layout('initAssetWeight'),
        I80F48Layout('maintLiabWeight'),
        I80F48Layout('initLiabWeight'),
        I80F48Layout('liquidationFee'),
        I80F48Layout('makerFee'),
        I80F48Layout('takerFee'),
        i64('baseLotSize'),
        i64('quoteLotSize'),
      ],
      property,
    );
  }

  decode(b, offset) {
    return new PerpMarketInfo(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}

export function perpMarketInfoLayout(property = '') {
  return new PerpMarketInfoLayout(property);
}

export class PerpAccountLayout extends Structure {
  constructor(property) {
    super(
      [
        i64('basePosition'),
        I80F48Layout('quotePosition'),
        I80F48Layout('longSettledFunding'),
        I80F48Layout('shortSettledFunding'),
        i64('bidsQuantity'),
        i64('asksQuantity'),
        i64('takerBase'),
        i64('takerQuote'),
        u64('mngoAccrued'),
      ],
      property,
    );
  }

  decode(b, offset) {
    return new PerpAccount(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}

export function perpAccountLayout(property = '') {
  return new PerpAccountLayout(property);
}

export const MangoGroupLayout = struct([
  metaDataLayout('metaData'),
  u64('numOracles'), //usize?

  seq(tokenInfoLayout(), MAX_TOKENS, 'tokens'),
  seq(spotMarketInfoLayout(), MAX_PAIRS, 'spotMarkets'),
  seq(perpMarketInfoLayout(), MAX_PAIRS, 'perpMarkets'),

  seq(publicKeyLayout(), MAX_PAIRS, 'oracles'),

  u64('signerNonce'),
  publicKeyLayout('signerKey'),
  publicKeyLayout('admin'),
  publicKeyLayout('dexProgramId'),
  publicKeyLayout('mangoCache'),
  u64('validInterval'),
  publicKeyLayout('insuranceVault'),
  publicKeyLayout('srmVault'),
  publicKeyLayout('msrmVault'),
  publicKeyLayout('feesVault'),
  seq(u8(), 32, 'padding'),
]);

export const MangoAccountLayout = struct([
  metaDataLayout('metaData'),
  publicKeyLayout('mangoGroup'),
  publicKeyLayout('owner'),
  seq(bool(), MAX_PAIRS, 'inMarginBasket'),
  u8('numInMarginBasket'),
  seq(I80F48Layout(), MAX_TOKENS, 'deposits'),
  seq(I80F48Layout(), MAX_TOKENS, 'borrows'),
  seq(publicKeyLayout(), MAX_PAIRS, 'spotOpenOrders'),
  seq(perpAccountLayout(), MAX_PAIRS, 'perpAccounts'),

  seq(u8(), MAX_PERP_OPEN_ORDERS, 'orderMarket'),
  seq(sideLayout(1), MAX_PERP_OPEN_ORDERS, 'orderSide'),
  seq(i128(), MAX_PERP_OPEN_ORDERS, 'orders'),
  seq(u64(), MAX_PERP_OPEN_ORDERS, 'clientOrderIds'),

  u64('msrmAmount'),

  bool('beingLiquidated'),
  bool('isBankrupt'),
  seq(u8(), INFO_LEN, 'info'),
  seq(u8(), 70, 'padding'),
]);

export const RootBankLayout = struct([
  metaDataLayout('metaData'),
  I80F48Layout('optimalUtil'),
  I80F48Layout('optimalRate'),
  I80F48Layout('maxRate'),
  u64('numNodeBanks'), // usize?
  seq(publicKeyLayout(), MAX_NODE_BANKS, 'nodeBanks'),
  I80F48Layout('depositIndex'),
  I80F48Layout('borrowIndex'),
  u64('lastUpdated'),
  seq(u8(), 64, 'padding'),
]);

export const NodeBankLayout = struct([
  metaDataLayout('metaData'),
  I80F48Layout('deposits'),
  I80F48Layout('borrows'),
  publicKeyLayout('vault'),
]);

export const StubOracleLayout = struct([
  seq(u8(), 8),
  I80F48Layout('price'),
  u64('lastUpdate'),
]);

export class LiquidityMiningInfoLayout extends Structure {
  constructor(property) {
    super(
      [
        I80F48Layout('rate'),
        I80F48Layout('maxDepthBps'),

        u64('periodStart'),
        u64('targetPeriodLength'),
        u64('mngoLeft'),
        u64('mngoPerPeriod'),
      ],
      property,
    );
  }

  decode(b, offset) {
    return new MetaData(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}
export function liquidityMiningInfoLayout(property = '') {
  return new LiquidityMiningInfoLayout(property);
}

export const PerpMarketLayout = struct([
  metaDataLayout('metaData'),
  publicKeyLayout('mangoGroup'),
  publicKeyLayout('bids'),
  publicKeyLayout('asks'),
  publicKeyLayout('eventQueue'),
  i64('quoteLotSize'),
  i64('baseLotSize'),

  I80F48Layout('longFunding'),
  I80F48Layout('shortFunding'),
  i64('openInterest'),
  u64('lastUpdated'),
  u64('seqNum'),
  I80F48Layout('feesAccrued'),
  liquidityMiningInfoLayout('liquidityMiningInfo'),
  publicKeyLayout('mngoVault'),
]);
const EVENT_SIZE = 200;
export const PerpEventLayout = union(
  u8('eventType'),
  blob(EVENT_SIZE - 1),
  'event',
);
PerpEventLayout.addVariant(
  0,
  struct([
    sideLayout(1, 'takerSide'),
    u8('makerSlot'),
    bool('makerOut'),
    seq(u8(), 4),
    u64('timestamp'),
    u64('seqNum'),
    publicKeyLayout('maker'),
    i128('makerOrderId'),
    u64('makerClientOrderId'),
    I80F48Layout('makerFee'),
    i64('bestInitial'),
    u64('makerTimestamp'),

    publicKeyLayout('taker'),
    i128('takerOrderId'),
    u64('takerClientOrderId'),
    I80F48Layout('takerFee'),

    i64('price'),
    i64('quantity'),
  ]),
  'fill',
);
PerpEventLayout.addVariant(
  1,
  struct([
    sideLayout(1, 'side'),
    u8('slot'),
    seq(u8(), 5),
    u64('timestamp'),
    u64('seqNum'),
    publicKeyLayout('owner'),
    i64('quantity'),
    seq(u8(), EVENT_SIZE - 64, 'padding'),
  ]),
  'out',
);
PerpEventLayout.addVariant(
  2,
  struct([
    seq(u8(), 7),
    u64('timestamp'),
    u64('seqNum'),
    publicKeyLayout('liqee'),
    publicKeyLayout('liqor'),
    I80F48Layout('price'),
    i64('quantity'),
    I80F48Layout('liquidationFee'),
    seq(u8(), EVENT_SIZE - 128, 'padding'),
  ]),
  'liquidate',
);

export interface FillEvent {
  takerSide: 'buy' | 'sell';
  makerSlot: number;
  makerOut: boolean;
  timestamp: BN;
  seqNum: BN;

  maker: PublicKey;
  makerOrderId: BN;
  makerClientOrderId: BN;
  makerFee: I80F48;
  bestInitial: BN;
  makerTimestamp: BN; // this is timestamp of maker order not timestamp of trade

  taker: PublicKey;
  takerOrderId: BN;
  takerClientOrderId: BN;
  takerFee: I80F48;

  price: BN;
  quantity: BN;
}

export interface OutEvent {
  side: 'buy' | 'sell';
  slot: number;
  timestamp: BN;
  seqNum: BN;
  owner: PublicKey;
  quantity: BN;
}

export interface LiquidateEvent {
  timestamp: BN;
  seqNum: BN;
  liqee: PublicKey;
  liqor: PublicKey;
  price: I80F48;
  quantity: BN; // i64
  liquidationFee: I80F48; // same as what's in the PerpMarketInfo
}

export const PerpEventQueueHeaderLayout = struct([
  metaDataLayout('metaData'),
  u64('head'),
  u64('count'),
  u64('seqNum'),
]);

export const PerpEventQueueLayout = struct([
  metaDataLayout('metaData'),
  u64('head'),
  u64('count'),
  u64('seqNum'),
  seq(PerpEventLayout, greedy(PerpEventLayout.span), 'events'),
]);

const BOOK_NODE_SIZE = 88;
const BOOK_NODE_LAYOUT = union(u32('tag'), blob(BOOK_NODE_SIZE - 4), 'node');
BOOK_NODE_LAYOUT.addVariant(0, struct([]), 'uninitialized');
BOOK_NODE_LAYOUT.addVariant(
  1,
  struct([
    // Only the first prefixLen high-order bits of key are meaningful
    u32('prefixLen'),
    u128('key'),
    seq(u32(), 2, 'children'),
  ]),
  'innerNode',
);
BOOK_NODE_LAYOUT.addVariant(
  2,
  struct([
    u8('ownerSlot'), // Index into OPEN_ORDERS_LAYOUT.orders
    blob(3),
    u128('key'), // (price, seqNum)
    publicKeyLayout('owner'), // Open orders account
    u64('quantity'), // In units of lot size
    u64('clientOrderId'),
    u64('bestInitial'),
    u64('timestamp'),
  ]),
  'leafNode',
);
BOOK_NODE_LAYOUT.addVariant(3, struct([u32('next')]), 'freeNode');
BOOK_NODE_LAYOUT.addVariant(4, struct([]), 'lastFreeNode');

export const BookSideLayout = struct([
  metaDataLayout('metaData'),
  nu64('bumpIndex'),
  nu64('freeListLen'),
  u32('freeListHead'),
  u32('rootNode'),
  nu64('leafCount'),
  seq(BOOK_NODE_LAYOUT, MAX_BOOK_NODES, 'nodes'),
]);

export class PriceCache {
  price!: I80F48;
  lastUpdate!: BN;

  constructor(decoded: any) {
    Object.assign(this, decoded);
  }
}
export class PriceCacheLayout extends Structure {
  constructor(property) {
    super([I80F48Layout('price'), u64('lastUpdate')], property);
  }

  decode(b, offset) {
    return new PriceCache(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}
export function priceCacheLayout(property = '') {
  return new PriceCacheLayout(property);
}

export class RootBankCache {
  depositIndex!: I80F48;
  borrowIndex!: I80F48;
  lastUpdate!: BN;

  constructor(decoded: any) {
    Object.assign(this, decoded);
  }
}
export class RootBankCacheLayout extends Structure {
  constructor(property) {
    super(
      [
        I80F48Layout('depositIndex'),
        I80F48Layout('borrowIndex'),
        u64('lastUpdate'),
      ],
      property,
    );
  }

  decode(b, offset) {
    return new RootBankCache(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}
export function rootBankCacheLayout(property = '') {
  return new RootBankCacheLayout(property);
}

export class PerpMarketCache {
  longFunding!: I80F48;
  shortFunding!: I80F48;
  lastUpdate!: BN;

  constructor(decoded: any) {
    Object.assign(this, decoded);
  }
}
export class PerpMarketCacheLayout extends Structure {
  constructor(property) {
    super(
      [
        I80F48Layout('longFunding'),
        I80F48Layout('shortFunding'),
        u64('lastUpdate'),
      ],
      property,
    );
  }

  decode(b, offset) {
    return new PerpMarketCache(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}
export function perpMarketCacheLayout(property = '') {
  return new PerpMarketCacheLayout(property);
}

export const MangoCacheLayout = struct([
  metaDataLayout('metaData'),
  seq(priceCacheLayout(), MAX_PAIRS, 'priceCache'),
  seq(rootBankCacheLayout(), MAX_TOKENS, 'rootBankCache'),
  seq(perpMarketCacheLayout(), MAX_PAIRS, 'perpMarketCache'),
]);

export class MangoCache {
  publicKey: PublicKey;

  priceCache!: PriceCache[];
  rootBankCache!: RootBankCache[];
  perpMarketCache!: PerpMarketCache[];

  constructor(publicKey: PublicKey, decoded: any) {
    this.publicKey = publicKey;
    Object.assign(this, decoded);
  }
}

export class NodeBank {
  publicKey: PublicKey;

  deposits!: I80F48;
  borrows!: I80F48;
  vault!: PublicKey;

  constructor(publicKey: PublicKey, decoded: any) {
    this.publicKey = publicKey;
    Object.assign(this, decoded);
  }
}

export const TokenAccountLayout = struct([
  publicKeyLayout('mint'),
  publicKeyLayout('owner'),
  nu64('amount'),
  blob(93),
]);
