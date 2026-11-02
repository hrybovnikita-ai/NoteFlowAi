function invalidTokenResponse(response) {
  if (!response || response.status !== 401) return false;
  if (response.data?.error?.code === "INVALID_TOKEN") return true;
  if (typeof response.clone !== "function") return false;
  return response.clone().json()
    .then(payload => payload?.error?.code === "INVALID_TOKEN")
    .catch(() => false);
}

export async function retryWithFreshIdToken(user, send, firstResponse) {
  if (!await invalidTokenResponse(firstResponse)) return firstResponse;
  const refreshedToken = await user.getIdToken(true);
  return send(refreshedToken);
}

export async function sendWithFreshIdToken(user, send) {
  const token = await user.getIdToken();
  let response;
  try {
    response = await send(token);
  } catch (error) {
    if (!await invalidTokenResponse(error.response)) throw error;
    const refreshedToken = await user.getIdToken(true);
    return send(refreshedToken);
  }
  return retryWithFreshIdToken(user, send, response);
}
