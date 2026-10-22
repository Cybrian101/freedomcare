// Network helpers. "Online" in the browser only means a network interface is up: on camp wifi without internet a request
// can hang for a minute. Every call that a person is waiting for must give up quickly and fall back to what is on the phone.

/** Reject after `ms`. The underlying request is not cancelled, its result is simply ignored. */
export function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
