type Track = {
  title: string;
  artist: string;
  album?: string;
};

export function attachMediaSession(audio: HTMLAudioElement, track: Track): void {
  const session = navigator.mediaSession;
  if (!session) return;
  const artwork = [192, 512].map((size) => ({
    src: `${location.origin}/icons/icon-${size}.png`,
    sizes: `${size}x${size}`,
    type: "image/png",
  }));
  session.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album || "Yomu",
    artwork,
  });
  const bind = (action: MediaSessionAction, run: () => void) => {
    try {
      session.setActionHandler(action, run);
    } catch {
      /* this browser does not support that action */
    }
  };
  bind("play", () => {
    void audio.play();
  });
  bind("pause", () => {
    audio.pause();
  });
  bind("seekbackward", () => {
    audio.currentTime = Math.max(0, audio.currentTime - 10);
  });
  bind("seekforward", () => {
    audio.currentTime = Math.min(audio.duration || audio.currentTime + 10, audio.currentTime + 10);
  });
}
