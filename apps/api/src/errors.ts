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

export class ApiHttpError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  get status(): ContentfulStatusCode {
    return statusByCode[this.code];
  }

  toBody(): ApiError {
    return { error: { code: this.code, message: this.message, ...(this.details === undefined ? {} : { details: this.details }) } };
  }
}
