import { UserRepo } from "../repos/UserRepo";
import { LoginRequest, PasswordResetRequest, SessionUser } from "../types/models";

export const loginRateLimitMaxFailedAttempts = 5;
export const loginRateLimitWindowMs = 15 * 60 * 1000;
export const loginLockoutMs = 15 * 60 * 1000;

export interface PasswordResetResult {
  accepted: true;
  matchedUser: boolean;
}

export interface LoginThrottleState {
  limited: boolean;
  failedAttempts: number;
  remainingAttempts: number;
  maxFailedAttempts: number;
  retryAfterSeconds?: number;
  lockedUntil?: string;
}

interface LoginAttemptState {
  failedAttempts: number;
  firstFailedAt: number;
  lockedUntil?: number;
}

export class AuthService {
  private readonly loginAttempts = new Map<string, LoginAttemptState>();

  constructor(private readonly userRepo: UserRepo) {}

  async login(credentials: LoginRequest): Promise<SessionUser | null> {
    const now = new Date().toISOString();
    const user = await this.userRepo.findByEmail(this.normalizeLoginKey(credentials.email));
    if (!user || user.password !== credentials.password || user.status !== "Active") {
      return null;
    }

    await this.userRepo.touchLastLogin(user.id, now);

    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      status: user.status,
      lastLogin: now,
    };
  }

  checkLoginThrottle(email: string, nowMs = Date.now()): LoginThrottleState {
    const key = this.normalizeLoginKey(email);
    const state = this.loginAttempts.get(key);
    if (!state) {
      return this.unlimitedState(0);
    }

    if (state.lockedUntil && state.lockedUntil > nowMs) {
      return this.lockedState(state, nowMs);
    }

    if (state.lockedUntil || nowMs - state.firstFailedAt > loginRateLimitWindowMs) {
      this.loginAttempts.delete(key);
      return this.unlimitedState(0);
    }

    return this.unlimitedState(state.failedAttempts);
  }

  recordLoginFailure(email: string, nowMs = Date.now()): LoginThrottleState {
    const key = this.normalizeLoginKey(email);
    const existing = this.loginAttempts.get(key);
    const state =
      existing && nowMs - existing.firstFailedAt <= loginRateLimitWindowMs
        ? existing
        : { failedAttempts: 0, firstFailedAt: nowMs };

    state.failedAttempts += 1;

    if (state.failedAttempts >= loginRateLimitMaxFailedAttempts) {
      state.lockedUntil = nowMs + loginLockoutMs;
      this.loginAttempts.set(key, state);
      return this.lockedState(state, nowMs);
    }

    this.loginAttempts.set(key, state);
    return this.unlimitedState(state.failedAttempts);
  }

  recordLoginSuccess(email: string) {
    this.loginAttempts.delete(this.normalizeLoginKey(email));
  }

  async requestPasswordReset(request: PasswordResetRequest): Promise<PasswordResetResult> {
    const user = await this.userRepo.findByEmail(this.normalizeLoginKey(request.email));
    return {
      accepted: true,
      matchedUser: Boolean(user && user.status === "Active"),
    };
  }

  private normalizeLoginKey(email: string) {
    return email.trim().toLowerCase();
  }

  private unlimitedState(failedAttempts: number): LoginThrottleState {
    return {
      limited: false,
      failedAttempts,
      remainingAttempts: Math.max(loginRateLimitMaxFailedAttempts - failedAttempts, 0),
      maxFailedAttempts: loginRateLimitMaxFailedAttempts,
    };
  }

  private lockedState(state: LoginAttemptState, nowMs: number): LoginThrottleState {
    const lockedUntil = state.lockedUntil ?? nowMs;
    return {
      limited: true,
      failedAttempts: state.failedAttempts,
      remainingAttempts: 0,
      maxFailedAttempts: loginRateLimitMaxFailedAttempts,
      retryAfterSeconds: Math.max(Math.ceil((lockedUntil - nowMs) / 1000), 0),
      lockedUntil: new Date(lockedUntil).toISOString(),
    };
  }
}
