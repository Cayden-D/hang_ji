export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (message = 'Resource not found') => new AppError(404, 'NOT_FOUND', message);
export const forbidden = (message = 'Permission denied') => new AppError(403, 'FORBIDDEN', message);
export const conflict = (message) => new AppError(409, 'CONFLICT', message);
