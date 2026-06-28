Architecture & Technical Design Specification
Project: Lightweight Extensible Server Panel Host

Tech Stack: Tauri v2, Rust, React, Tailwind CSS, TypeScript

1. System Topology & Directory Structure
To support both custom file locations and a default sandbox environment, the system utilizes a strict layout across the user’s file system.

Plaintext
📂 AppData/Roaming/[YourAppName]/ (Core Sandbox)
├── 📄 config.json                 <-- Global registry of server instances & settings
└── 📂 plugins/                    <-- Community extensions directory
    └── 📂 discord-bot-manager/
        ├── 📄 manifest.json       <-- Metadata, configuration fields, backend orchestration
        └── 📂 dist/
            └── 📄 index.js        <-- Compiled ESM frontend bundle for Shadow DOM rendering

📂 Users/Elliot/Documents/... (Optional Custom Path)
└── 📂 my-web-api/                 <-- User-selected location for a specific instance
    ├── 📄 latest.log              <-- Appended continuously by the Rust process wrapper
    └── [Instance Files]           <-- node_modules, package.json, main.py, etc.
2. Core Registry Schema (config.json)
The global config.json tracks server instances. If an instance's path becomes inaccessible, the core marks it as orphaned instead of deleting it.

JSON
{
  "version": "2.0.0",
  "settings": {
    "defaultSandboxPath": "C:\\Users\\...\\AppData\\Roaming\\[AppName]\\servers"
  },
  "servers": {
    "srv_9f82b1a0": {
      "id": "srv_9f82b1a0",
      "name": "Production API",
      "serverType": "web_server",
      "path": "C:\\Projects\\my-web-api",
      "status": "stopped",
      "isOrphaned": false,
      "userOverrides": {
        "package_manager": "bun",
        "port": "3000",
        "env_mode": "production"
      }
    }
  }
}
3. Plugin Manifest Specification (manifest.json)
Every community plugin must supply a manifest.json. This file tells the host how to render the customization UI and how to run backend tasks.

JSON
{
  "id": "web_server",
  "displayName": "Universal Web Server",
  "version": "1.0.0",
  "author": "CommunityDev",
  "uiEntry": "dist/index.js",
  "configSchema": [
    {
      "key": "package_manager",
      "label": "Package Manager",
      "type": "select",
      "options": ["npm", "bun", "pnpm"],
      "default": "npm"
    },
    {
      "key": "port",
      "label": "Application Port",
      "type": "text",
      "default": "8080"
    }
  ],
  "lifecycle": {
    "install": {
      "command": "{{userOverrides.package_manager}}",
      "args": ["install"]
    },
    "start": {
      "command": "{{userOverrides.package_manager}}",
      "args": ["run", "start"]
    }
  }
}
4. Frontend Architecture: Shadow DOM & Dynamic Variable Rendering
To protect the host from Tailwind style bleed and broken classes, every plugin UI component is mounted inside an isolated Shadow DOM.

Dynamic Form Engine (src/components/DynamicForm.tsx)
When creating or modifying a server, the host dynamically generates the configuration screen based on the plugin's configSchema:

TypeScript
import React from 'react';

interface SchemaField {
  key: string;
  label: string;
  type: 'text' | 'select';
  options?: string[];
  default: string;
}

export function DynamicForm({ schema, values, onChange }: { 
  schema: SchemaField[], 
  values: Record<string, string>, 
  onChange: (key: string, value: string) => void 
}) {
  return (
    <div className="space-y-4">
      {schema.map((field) => (
        <div key={field.key} className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-300">{field.label}</label>
          {field.type === 'select' ? (
            <select 
              value={values[field.key] || field.default}
              onChange={(e) => onChange(field.key, e.target.value)}
              className="bg-zinc-800 text-white p-2 rounded border border-zinc-700"
            >
              {field.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          ) : (
            <input 
              type="text" 
              value={values[field.key] || field.default}
              onChange={(e) => onChange(field.key, e.target.value)}
              className="bg-zinc-800 text-white p-2 rounded border border-zinc-700"
            />
          )}
        </div>
      ))}
    </div>
  );
}
Isolated Panel Container (src/components/PluginWrapper.tsx)
This wrapper isolates community plugin styles, keeping your dashboard interface intact.

TypeScript
import React, { useEffect, useRef } from 'react';

export function PluginWrapper({ scriptUrl, serverData }: { scriptUrl: string, serverData: any }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Clear container and create Shadow Root
    containerRef.current.innerHTML = '';
    const shadow = containerRef.current.attachShadow({ mode: 'open' });

    // 2. Create a mount element inside the shadow root
    const mountPoint = document.createElement('div');
    shadow.appendChild(mountPoint);

    // 3. Inject Tailwind styles compiled for the plugin specifically
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = scriptUrl.replace('.js', '.css');
    shadow.appendChild(link);

    // 4. Runtime import the plugin code
    import(/* @vite-ignore */ scriptUrl).then((plugin) => {
      if (plugin.mount) {
        // Core framework exposes a mounting function to the plugin
        plugin.mount(mountPoint, serverData);
      }
    }).catch(err => console.error("Failed to execute plugin UI:", err));

  }, [scriptUrl, serverData]);

  return <div ref={containerRef} />;
}
5. Backend Architecture: Variable Process Lifecycle Execution
The Rust backend handles two jobs: resolving configuration variables from the manifest and streaming server output to log files.

Process Command Construction (src/commands.rs)
This demonstrates how Rust takes user selections (like bun instead of npm) and sets up the server run context.

Rust
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use tauri_plugin_shell::ShellExt;

#[tauri::command]
pub async fn launch_server_instance(
    app_handle: tauri::AppHandle,
    instance_id: String,
    working_dir: String,
    raw_command: String,
    raw_args: Vec<String>,
    user_overrides: HashMap<String, String>,
) -> Result<(), String> {
    
    // 1. Process variable replacement (e.g., {{userOverrides.package_manager}} -> "bun")
    let resolved_command = resolve_variables(raw_command, &user_overrides);
    let resolved_args: Vec<String> = raw_args.into_iter()
        .map(|arg| resolve_variables(arg, &user_overrides))
        .collect();

    // 2. Open the dedicated runtime log file
    let log_path = PathBuf::from(&working_dir).join("latest.log");
    let mut log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|e| e.to_string())?;

    // 3. Execute process via Tauri Shell Plugin
    let (mut rx, _child) = app_handle
        .shell()
        .command(resolved_command)
        .args(resolved_args)
        .current_dir(PathBuf::from(&working_dir))
        .spawn()
        .map_err(|e| e.to_string())?;

    // 4. Run background loop to capture stdout and write directly to disk
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let tauri_plugin_shell::process::CommandEvent::Stdout(line) = event {
                let _ = log_file.write_all(&line);
                let _ = log_file.write_all(b"\n");
                
                // Stream live updates out to the UI log-terminal stream
                let string_line = String::from_utf8_lossy(&line).to_string();
                let _ = app_handle.emit(&format!("log:{}:stream", instance_id), string_line);
            }
        }
    });

    Ok(())
}

fn resolve_variables(target: String, variables: &HashMap<String, String>) -> String {
    let mut output = target;
    for (key, val) in variables {
        let pattern = format!("{{{{userOverrides.{}}}}}", key);
        output = output.replace(&pattern, val);
    }
    output
}
6. Implementation Milestones
To manage development without getting overwhelmed, follow this structured roadmap:

Phase 1: Core Host Setup (Week 1)
Initialize Tauri v2 with React + Tailwind CSS + TypeScript.

Set up global app state tracking (config.json) with standard CRUD operations via Rust file commands.

Establish handling for missing or deleted server folders ("Orphaned state").

Phase 2: Shell & Log Infrastructure (Week 2)
Implement tauri-plugin-shell integration to launch processes dynamically based on commands.

Build the file-writing process pipeline to route terminal logs directly into a local latest.log.

Build a React terminal viewer that streams new entries using event listeners.

Phase 3: Manifest Engine & Shadow DOM (Week 3)
Write the configuration string replacement engine in Rust.

Implement the dynamic UI assembly system to generate forms out of configuration schemas.

Build the Shadow DOM layout injector to keep third-party plugin designs securely contained.