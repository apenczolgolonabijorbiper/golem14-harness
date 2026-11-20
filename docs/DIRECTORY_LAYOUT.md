# Application, engine and instance data

A Golem integration has an application, an installed harness engine, and an
instance data directory. The engine supplies reusable code and agent instructions.
An instance supplies a particular memory, identity, observations and question
history. Multiple instances can use the same engine version with independent data.

## What each path means

| Path or option | Meaning | Typical contents | Who maintains it |
| --- | --- | --- | --- |
| Extracted release directory | Installer source obtained from the release ZIP | RELEASE.json, integration/, processor/, schemas/ | Harness publisher |
| --repo | Root of the application that will use Golem | Application code, AGENTS.md, docs/ | Application developer |
| --repo/vendor/golem-harness | Installed engine, also called HARNESS_ROOT | Verified release files, processing protocol, validators | Harness publisher, replaced during a reviewed upgrade |
| --instance-root | Data directory for one Golem instance, also called INSTANCE_ROOT | inbox/, evidence/, memory/, instance/, profiles/, questions/ | The application and its authorized agent |

The installer copies the verified release to the fixed vendor/golem-harness
location under --repo. You choose --instance-root independently. The installer
records that data path in application AGENTS.md. The initializer subsequently
creates an empty data structure there. Installing alone leaves data uninitialized.

The instance directory contains the material that Golem remembers over time.
For example, memory/graph.json holds source-grounded claims, inbox/ holds original
observations, and instance/purpose.md holds the instance's purpose and scope.
It contains no second engine installation. Engine updates replace installed
release files while preserving the selected instance data and its history.

## Recommended starting layout

For a new application, use one engine copy in that application's vendor directory
and one dedicated instance data directory outside the application checkout. This
keeps source checkouts, code upgrades and data backups independently manageable.
Use the following corresponding examples, replacing the roots with your paths:

| Purpose | Windows example | Linux/macOS example |
| --- | --- | --- |
| Extracted release, where you run the installer | C:/Downloads/golem-harness | /home/me/downloads/golem-harness |
| Application root, supplied as --repo | C:/Projects/MyApp | /home/me/projects/MyApp |
| Installed engine, created by installer | C:/Projects/MyApp/vendor/golem-harness | /home/me/projects/MyApp/vendor/golem-harness |
| Instance data, supplied as --instance-root | C:/GolemData/MyApp | /home/me/golem-data/MyApp |

Run from the extracted release on Windows:

```powershell
py integration/install-codex.py --repo "C:/Projects/MyApp" --instance-root "C:/GolemData/MyApp"
```

Run from the extracted release on Linux or macOS:

```sh
python3 integration/install-codex.py --repo "/home/me/projects/MyApp" --instance-root "/home/me/golem-data/MyApp"
```

Use install-cursor.py with the same two paths for Cursor. Directory names such as
MyApp and GolemData are examples you can change. Earlier examples used
private-instance and MyApp-golem for the same instance data role. Those names
have no special meaning to the harness. In generic examples, /absolute/application
means the absolute application path and /absolute/private-instance means the
absolute data path. Neither is a literal folder to create.

## Data inside the application is also supported

You may choose C:/Projects/MyApp/runtime/golem-data, or the corresponding directory
on your system, as --instance-root. It must stay outside the installed engine.
This layout can make the data easier to reach from a local project workspace.
Keep private data out of source releases and public version control. If using Git,
add /runtime/golem-data/ to the application's .gitignore before creating private
content and verify that it is untracked. Ignore rules do not remove tracked files.
The installer preserves the application's .gitignore, so configure that exclusion
in the application yourself or during an explicitly requested guided setup.

External storage and ignored in-project storage are both supported choices. The
setup conversation should explain the trade-off and ask which location to use.
The word private describes the intended handling of instance data. Actual privacy
depends on filesystem permissions, repository visibility and the storage provider.
Directory placement alone supplies no access controls.

## Applications, hosts and shared memory

Start with a separate instance per application or purpose. For example, MyApp can
use C:/GolemData/MyApp while AnotherApp uses C:/GolemData/AnotherApp. Each consuming
application installs its own verified engine copy in its vendor/golem-harness.
The installer supplies no machine-wide shared engine installation.

Cursor, Codex CLI, Codex Desktop and ChatGPT Work may intentionally operate on the
same application's instance. They use its configured data location and storage
adapter. A directory outside the application stays dedicated to that instance
unless another application is explicitly configured to use it.

Sharing a single instance between applications means sharing its identity,
evidence, memory, questions and processed ledger. Make that an explicit product
decision. All writers must use a compatible engine/schema and the same lease and
atomic completion protocol. Concurrent sessions and new worktrees must resolve
the intended data location before writing. The setup record should retain its
canonical location so a relative path cannot select a different instance.

## Back up and upgrade

Back up the whole instance as a consistent snapshot, including original sources,
graph, processed ledger and both question queues. Back up application configuration
that records its location separately. See docs/PROCESSING.md for recovery rules.
When upgrading the engine, follow README.md, keep the data location, and validate
the existing instance before resuming. Run the initializer only for a new empty
destination.
