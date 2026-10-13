import { SwapError } from "@levra/kyber";
import type { ApiError, ApiErrorCode } from "@levra/shared/api";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const statusByCode: Record<ApiErrorCode, ContentfulStatusCode> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  REGION_BLOCKED: 403,
  TERMS_NOT_ACCEPTED: 403,
  NOT_FOUND: 404,
  QUOTE_EXPIRED: 409,
  NO_ROUTE: 422,
  INSUFFICIENT_LIQUIDITY: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UPSTREAM_ERROR: 502,
};

/** A swap aggregator error keeps its own code (`NO_ROUTE`, `RATE_LIMITED`, `UPSTREAM_ERROR`), which the API shares. */
export function fromSwapError(err: SwapError): ApiHttpError {
  return new ApiHttpError(err.code, err.message, err.details, err.cause);
}

/** Runs a chain or outside-service read. A failure becomes UPSTREAM_ERROR, never an approximate answer. */
export async function upstream<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof ApiHttpError) throw err;
    if (err instanceof SwapError) throw fromSwapError(err);
    throw new ApiHttpError("UPSTREAM_ERROR", "Could not read the chain. Try again shortly.", undefined, err);
  }
}

export class ApiHttpError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
    cause?: unknown,
  ) {
    super(message, { cause });
  }

  get status(): ContentfulStatusCode {
    return statusByCode[this.code];
  }

  toBody(): ApiError {
    return { error: { code: this.code, message: this.message, ...(this.details === undefined ? {} : { details: this.details }) } };
  }
}
