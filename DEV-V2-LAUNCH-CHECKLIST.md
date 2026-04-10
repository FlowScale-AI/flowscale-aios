# Flowscale AIOS v2 — Feature & Launch Checklist

## Feature Checklist

### 1. ComfyUI Process Management
- [ ] Users can start, stop, and restart ComfyUI directly from the app
- [ ] The app shows live status of each ComfyUI instance (running, starting, stopped)
- [ ] ComfyUI keeps running even if the app reloads or restarts
- [ ] The app detects if ComfyUI is already running elsewhere on the same GPU and warns the user to avoid conflicts

### 2. ComfyUI Setup Wizard
- [ ] Guided first-time setup with three options: use an existing GitHub installation, use the ComfyUI Desktop App, or let Flowscale manage everything
- [ ] The app validates the user's chosen ComfyUI location before proceeding
- [ ] Required files are automatically copied into the ComfyUI installation
- [ ] All setup choices are saved and remembered across sessions

### 3. GPU Detection
- [ ] Automatically detects installed GPUs
- [ ] Shows detected GPU and CPU information on the Providers page
- [ ] Users can manually re-scan hardware at any time

### 4. Multi-GPU Support
- [ ] Automatically creates one ComfyUI instance per GPU, plus a CPU-only fallback
- [ ] Each instance runs on its own dedicated GPU — no cross-talk between them
- [ ] Uses a dedicated port range to avoid conflicts with manually launched ComfyUI
- [ ] The ComfyUI integration page shows a full control panel for all instances

### 5. Smart Instance Selection
- [ ] A new dropdown lets users pick which GPU/instance to run a job on
- [ ] Available everywhere jobs are run: Tool page, Build Tool test step, and Canvas
- [ ] "Auto" mode automatically distributes jobs across available GPUs in round-robin fashion

### 6. Tool Plugin System
- [ ] New tool type: AI model tools that run locally via plugins (in addition to ComfyUI workflow tools)
- [ ] Users can browse and install plugins from the Flowscale tool registry
- [ ] Users can refresh the registry to see newly published plugins
- [ ] Power users can drop custom plugins into a local folder and they auto-register
- [ ] Each plugin bundles a model server and a config describing its inputs/outputs

### 7. Improved Job Execution
- [ ] Plugin-based tools verify the model server is healthy before running
- [ ] Users can choose which GPU to use when running local AI model tools
- [ ] Job updates are now atomic — no more partial or corrupted results on failure
- [ ] Clearer, more descriptive error messages when something goes wrong

### 8. Local Inference Security & Stability
- [ ] Hardened input validation to prevent unsafe operations
- [ ] Safer process management for local model servers
- [ ] More robust error handling across all local inference operations

### 9. UI Improvements
- [ ] Tools page now shows loading indicators while fetching data
- [ ] Providers page redesigned with GPU/CPU hardware display
- [ ] Canvas execution bar updated with GPU instance selector
- [ ] App runner page supports GPU selection for local AI model tools

### 10. Housekeeping
- [ ] Removed leftover test artifacts that were bloating the repository
- [ ] Removed unused development scripts
- [ ] Cleaned up desktop build configuration

---

## GTM Launch Checklist

### Quality Assurance

#### Automated Tests
- [ ] All type checks pass
- [ ] All unit tests pass
- [ ] All end-to-end tests pass

#### Manual Testing — Setup & Hardware
- [ ] Fresh install: walk through the Setup Wizard for each of the three install types
- [ ] GPU detection works on a machine with a dedicated GPU
- [ ] Graceful fallback on a CPU-only machine (no GPU)

#### Manual Testing — Multi-Instance
- [ ] Start, stop, and restart individual ComfyUI instances from the integration page
- [ ] "Auto" routing distributes jobs across multiple running instances
- [ ] Instance selector dropdown works on the Tool page, Build Tool test, and Canvas

#### Manual Testing — Tool Plugins
- [ ] Install a plugin from the registry and run it successfully
- [ ] Place a custom plugin in the local folder and confirm it appears in the tools list
- [ ] Verify the app blocks execution if the plugin's model server is not running

#### Manual Testing — Edge Cases
- [ ] External ComfyUI conflict detection warns the user correctly (Linux)
- [ ] Desktop app builds successfully for Linux and macOS
- [ ] Existing single-GPU setups continue to work without regressions

### Platform Testing
- [ ] Linux desktop app — install and smoke test
- [ ] macOS desktop app — install and smoke test (especially the "Desktop App" install type)
- [ ] Windows desktop app — install and smoke test
- [ ] Browser-only mode (no desktop app) — everything still works

### Documentation & Communications
- [ ] Internal architecture docs reviewed for accuracy
- [ ] Write release notes highlighting: multi-GPU support, tool plugin system, setup wizard
- [ ] Update user-facing docs and website with new features
- [ ] Prepare changelog for the release

### Release
- [ ] Merge the feature branch into the main branch
- [ ] Tag the release to trigger automated builds
- [ ] Verify builds complete successfully for macOS, Linux, and Windows
- [ ] Review and publish the GitHub Release
- [ ] Announce on community channels (Discord, Twitter, etc.)

### Post-Launch Monitoring
- [ ] Monitor incoming bug reports and issue submissions
- [ ] Review application logs for new crash patterns
- [ ] Confirm the plugin registry is reachable and serving correctly
- [ ] Watch for user-reported port conflicts with other software
