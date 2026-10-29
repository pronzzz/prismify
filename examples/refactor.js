// Refactoring hints: try `prismify examples/refactor.js --refactor`

export function discountFor(user) {
  if (user.active) {
    if (user.age >= 18) {
      if (user.points >= 1000) {
        if (!user.banned) {
          return user.points * 0.15;
        }
      }
    }
  }
  return 0;
}

export function retryLater(job) {
  setTimeout(() => job.run(), 30000);
}

export function describe(res) {
  if (res.status === 404) return 'not found';
  return 'ok';
}
