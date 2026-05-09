import OracleReadingClient from "../OracleReadingClient";

export default function OracleAstroPage() {
  return (
    <OracleReadingClient
      apiPath="/api/oracle/astro"
      title="Western sky"
      blurb="We resolve your birthplace, cast tropical Sun · Moon · Ascendant locally, then the same council of readers writes in ordinary language—not jargon."
    />
  );
}
