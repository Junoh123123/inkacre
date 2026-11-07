// Inkacre.app's main executable: runs the Node inside the app with its launcher (bin/cli.mjs app), which starts
// Inkacre in the background — or finds it running — and opens the browser. A compiled program rather than a script
// so the app can be signed and notarized like any other. Built by scripts/package.mjs with clang.
#include <libgen.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(void) {
  char self[PATH_MAX], real[PATH_MAX], node[PATH_MAX], cli[PATH_MAX];
  uint32_t size = sizeof self;
  if (_NSGetExecutablePath(self, &size) != 0 || !realpath(self, real)) return 1;
  // …/Inkacre.app/Contents/MacOS/Inkacre → …/Inkacre.app/Contents
  char *macos = dirname(real), contents[PATH_MAX];
  snprintf(contents, sizeof contents, "%s/..", macos);
  snprintf(node, sizeof node, "%s/Resources/runtime/node", contents);
  snprintf(cli, sizeof cli, "%s/Resources/app/bin/cli.mjs", contents);
  execl(node, node, "--disable-warning=ExperimentalWarning", cli, "app", (char *)NULL);
  perror("Inkacre: could not run its Node");
  return 1;
}
