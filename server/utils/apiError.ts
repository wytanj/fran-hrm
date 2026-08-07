// Errors with room to explain themselves.
//
// `statusMessage` becomes the HTTP reason phrase, which must be a SHORT,
// single-line, ASCII string — Node mangles anything else and throws
// ERR_INVALID_CHAR on some characters. This project deliberately writes long,
// multi-line, actionable errors ("Constraints are not usable:\n- …"), so those
// belong in `message`, which travels in the JSON body untouched.
//
// Use apiError() for anything a human or an agent will read. Reserve bare
// createError() for terse machine-facing cases.

const REASONS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  423: 'Locked',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
}

/**
 * @param statusCode HTTP status
 * @param message    the full explanation — newlines and punctuation welcome
 * @param data       extra structured detail (validation errors, warnings…)
 */
export function apiError(statusCode: number, message: string, data?: unknown) {
  return createError({
    statusCode,
    statusMessage: REASONS[statusCode] || 'Request Failed',
    message,
    data,
  })
}

/** Read the human-facing text off a caught fetch error, whichever field carries it. */
export function errorText(err: any, fallback = 'Something went wrong'): string {
  return err?.data?.message || err?.data?.statusMessage || err?.message || err?.statusMessage || fallback
}
