// scripts/hostingPredeploy.cjs
//
// Runs before every `firebase deploy` that includes hosting (firebase.json
// hosting.predeploy). The website is only published by GitHub Actions
// (.github/workflows/deploy-website.yml), which builds it with the right
// project's settings. A deploy from a developer's computer would publish
// their local build instead: made from .env (the TEST project's settings)
// and possibly a development build. So a plain `firebase deploy --project
// live` typed by mistake stops here rather than breaking the live site.
//
// To roll back, use Firebase console > Hosting > release history.

if (process.env.GITHUB_ACTIONS !== "true") {
  console.error(
    "\nThe website is only deployed by GitHub Actions (push to main or test).\n" +
      "To deploy something else, name it: firebase deploy --only functions,firestore,storage\n" +
      "To roll back the website: Firebase console > Hosting > release history.\n",
  );
  process.exit(2); // not 1: on Windows the Firebase CLI reads 1 as "command not found"
}
