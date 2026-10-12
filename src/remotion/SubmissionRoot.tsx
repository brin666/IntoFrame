import { Composition, type AnyZodObject } from "remotion";
import manifestData from "../../public/samples/manifest.json";
import { createSubmissionFilmProps, parseSubmissionManifest, type SubmissionFilmProps } from "../demo/submissionAssets";
import { SubmissionFilm, SUBMISSION_DURATION_IN_FRAMES, SUBMISSION_FPS } from "./SubmissionFilm";

const manifest = parseSubmissionManifest(manifestData);
const filmProps = createSubmissionFilmProps(manifest);

export function SubmissionRoot() {
  return (
    <Composition<AnyZodObject, SubmissionFilmProps>
      id="IntoFrameDemo"
      component={SubmissionFilm}
      width={1920}
      height={1080}
      fps={SUBMISSION_FPS}
      durationInFrames={SUBMISSION_DURATION_IN_FRAMES}
      defaultProps={filmProps}
    />
  );
}
