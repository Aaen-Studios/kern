import { Composition } from "remotion";
import { KernVideo } from "./KernVideo";
import { HeroLoop } from "./HeroLoop";
import { VIDEO } from "./theme";

/**
 * Root composition registry. Both the main promo and the hero loop are
 * 1920×1080 @ 30fps; the loop is 6s, the promo is ~35s.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="KernVideo"
        component={KernVideo}
        durationInFrames={VIDEO.durationInFrames}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />
      <Composition
        id="HeroLoop"
        component={HeroLoop}
        durationInFrames={VIDEO.loopDurationInFrames}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />
    </>
  );
};
