#!/usr/bin/env bash

# publish.sh - Smart publication script for Speech is Cheap ASR
# Prep, clean, and publish to ClawHub using git metadata.

# 1. Configuration
SLUG="asr"
DISPLAY_NAME="Speech is Cheap Transcribe"
# The www host drops the CLI login, so publish to the apex registry.
REGISTRY="https://clawhub.ai"
PUBLISH_DIR="./publish"
SOURCE_DIR="."

# 2. Extract Version from manifest.json
VERSION=$(grep '"version":' manifest.json | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$VERSION" ]; then
    echo "❌ Error: Could not extract version from manifest.json"
    exit 1
fi

echo "🚀 Preparing to publish $DISPLAY_NAME v$VERSION..."

# 3. Extract Changelog from Git Tag
# Use the tag message without its signature, and strip backslashes.
CHANGELOG=$(git tag -l "$VERSION" --format='%(contents:subject)%0a%0a%(contents:body)' | tr -d '\\')

if [ -z "$CHANGELOG" ]; then
    echo "⚠️ Warning: No changelog found for tag $VERSION. Using default message."
    CHANGELOG="Release $VERSION"
fi

# 4. Clean and Prepare the Publish Folder
echo "🧹 Cleaning up $PUBLISH_DIR..."
rm -rf "$PUBLISH_DIR"
mkdir -p "$PUBLISH_DIR/scripts"

echo "📦 Copying essential files..."
cp "$SOURCE_DIR/manifest.json" "$PUBLISH_DIR/"
cp "$SOURCE_DIR/SKILL.md" "$PUBLISH_DIR/"
cp "$SOURCE_DIR/README.md" "$PUBLISH_DIR/"
cp "$SOURCE_DIR/CHANGELOG.md" "$PUBLISH_DIR/"
cp "$SOURCE_DIR/scripts/asr.sh" "$PUBLISH_DIR/scripts/"
cp "$SOURCE_DIR/scripts/x402.mjs" "$PUBLISH_DIR/scripts/"
cp "$SOURCE_DIR/package.json" "$PUBLISH_DIR/"
cp "$SOURCE_DIR/pnpm-lock.yaml" "$PUBLISH_DIR/"

echo "🔐 Ensuring execution permissions..."
chmod +x "$PUBLISH_DIR/scripts/asr.sh"

# 5. Final Confirmation
echo "--------------------------------------------------------"
echo "Slug:      $SLUG"
echo "Name:      $DISPLAY_NAME"
echo "Version:   $VERSION"
echo "Changelog: $CHANGELOG"
echo "Folder:    $PUBLISH_DIR"
echo "--------------------------------------------------------"

echo "Ready to publish? (y/n)"
read -r response
if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
    echo "📤 Publishing to ClawHub..."
    clawhub publish "$PUBLISH_DIR" \
        --slug "$SLUG" \
        --name "$DISPLAY_NAME" \
        --version "$VERSION" \
        --changelog "$CHANGELOG" \
        --registry "$REGISTRY"
else
    echo "⏹ Publish cancelled. Files are ready in $PUBLISH_DIR."
fi
