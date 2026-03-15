#!/usr/bin/env bash
set -euo pipefail

echo "=== Deploying Qwen Image Tools to Modal.com ==="
echo ""
echo "Prerequisites:"
echo "  - Python 3.11+ with 'modal' package installed (pip install modal)"
echo "  - Modal account configured (modal setup)"
echo "  - HuggingFace secret configured: modal secret create huggingface HF_TOKEN=<your-token>"
echo ""

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Tool definitions ─────────────────────────────────────────────────────────
TOOL_NAMES=(
  "Qwen Image"
  "Qwen Image 2512"
  "Qwen Image Edit"
  "Qwen Image Edit Plus (2511)"
  "Qwen Image Layered"
)
TOOL_SCRIPTS=(
  "qwen_image_modal.py"
  "qwen_image_2512_modal.py"
  "qwen_image_edit_modal.py"
  "qwen_image_edit_2511_modal.py"
  "qwen_image_layered_modal.py"
)
TOOL_MODELS=(
  "Qwen/Qwen-Image"
  "Qwen/Qwen-Image-2512"
  "Qwen/Qwen-Image-Edit"
  "Qwen/Qwen-Image-Edit-2511"
  "Qwen/Qwen-Image-Layered"
)

TOTAL=${#TOOL_NAMES[@]}

# ── Selection UI ─────────────────────────────────────────────────────────────
SELECTED=()
for ((i=0; i<TOTAL; i++)); do
  SELECTED+=(0)
done

echo "Which tools do you want to deploy?"
echo "Enter numbers to toggle (e.g. 1 3 5), 'a' to select all, then 'done' to deploy."
echo ""

print_menu() {
  for ((i=0; i<TOTAL; i++)); do
    if [ "${SELECTED[$i]}" -eq 1 ]; then
      mark="[x]"
    else
      mark="[ ]"
    fi
    echo "  $((i+1)). $mark ${TOOL_NAMES[$i]}"
  done
  echo ""
}

print_menu

while true; do
  printf "Toggle (1-%d), (a)ll, (n)one, (done): " "$TOTAL"
  read -r input

  if [ "$input" = "done" ]; then
    break
  elif [ "$input" = "a" ]; then
    for ((i=0; i<TOTAL; i++)); do SELECTED[$i]=1; done
    print_menu
  elif [ "$input" = "n" ]; then
    for ((i=0; i<TOTAL; i++)); do SELECTED[$i]=0; done
    print_menu
  else
    for num in $input; do
      idx=$((num - 1))
      if [ "$idx" -ge 0 ] && [ "$idx" -lt "$TOTAL" ]; then
        if [ "${SELECTED[$idx]}" -eq 1 ]; then
          SELECTED[$idx]=0
        else
          SELECTED[$idx]=1
        fi
      else
        echo "  Invalid: $num (pick 1-$TOTAL)"
      fi
    done
    print_menu
  fi
done

# ── Check at least one selected ──────────────────────────────────────────────
ANY=0
for ((i=0; i<TOTAL; i++)); do
  if [ "${SELECTED[$i]}" -eq 1 ]; then ANY=1; break; fi
done
if [ "$ANY" -eq 0 ]; then
  echo "No tools selected. Exiting."
  exit 0
fi

# ── Deploy selected ──────────────────────────────────────────────────────────
echo ""
DEPLOYED_MODELS=()
for ((i=0; i<TOTAL; i++)); do
  if [ "${SELECTED[$i]}" -eq 1 ]; then
    echo "────────────────────────────────────────"
    echo "Deploying: ${TOOL_NAMES[$i]}"
    echo "Script:    ${TOOL_SCRIPTS[$i]}"
    echo "────────────────────────────────────────"
    python3 -m modal deploy "$SCRIPTS_DIR/${TOOL_SCRIPTS[$i]}"
    DEPLOYED_MODELS+=("${TOOL_MODELS[$i]}")
    echo ""
  fi
done

# ── Summary ──────────────────────────────────────────────────────────────────
echo "=== Deployment complete! ==="
echo ""
echo "Next steps:"
echo "  1. Copy each endpoint URL from the output above"
echo "  2. In FlowScale AIOS, go to Settings > Modal Endpoints"
echo "  3. Add each deployed model:"
for model in "${DEPLOYED_MODELS[@]}"; do
  echo "     - $model"
done
echo "  4. Go to Tools and install the corresponding built-in tool(s)"
echo "  5. Restart your dev server and start using them!"
