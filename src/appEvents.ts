import { EventEmitter } from 'events';

// Shared event emitter instance
export const appEvents = new EventEmitter();

// Event constants
export const EVENT_TRACKED_WALLETS_CHANGED = 'tracked_wallets_changed'; 