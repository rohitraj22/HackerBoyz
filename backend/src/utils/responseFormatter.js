export function successResponse(data, message = 'Success') {
  return {
    success: true,
    message,
    data
  };
}

export function errorResponse(message = 'Something went wrong', details = null) {
  return {
    success: false,
    message,
    details
  };
}
