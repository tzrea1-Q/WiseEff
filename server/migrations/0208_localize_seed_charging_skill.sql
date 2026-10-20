-- Upgrade only the untouched publication created by 0196. Historical revisions
-- remain immutable; admin-authored identities, drafts and publications are skipped.
do $localize$
declare
  skill record;
  original_rules jsonb := $original_rules${
  "rules": [
    {
      "id": "thermal-foldback",
      "name": "热降额",
      "anyOf": [
        {
          "type": "text",
          "pattern": "thermal",
          "flags": "i"
        },
        {
          "type": "text",
          "pattern": "battery_temp",
          "flags": "i"
        },
        {
          "type": "text",
          "pattern": "foldback",
          "flags": "i"
        },
        {
          "type": "text",
          "pattern": "E_THERMAL_FOLDBACK",
          "flags": "i"
        }
      ],
      "stageId": "rootcause",
      "inference": "Thermal protection reduced charging output.",
      "suggestedAction": "Inspect pack temperature, cooling path, and BMS thermal thresholds before resuming fast charge.",
      "analysis": {
        "conclusion": {
          "value": "Charging behavior is consistent with thermal foldback protection.",
          "priority": 0
        },
        "impact": {
          "value": "Charging throughput may be reduced until pack temperature returns to the safe operating range.",
          "priority": 1
        },
        "severity": {
          "value": "Warning",
          "priority": 1
        },
        "confidence": {
          "value": 0.85,
          "priority": 0,
          "requiresErrorEvidence": true
        },
        "suggestedActions": [
          {
            "value": "Inspect pack temperature, cooling path, and BMS thermal thresholds before resuming fast charge.",
            "priority": 0
          },
          {
            "value": "Review ambient conditions and recent charge current requests for thermal stress.",
            "priority": 2
          }
        ]
      }
    },
    {
      "id": "charge-current-reduction",
      "name": "充电限流",
      "anyOf": [
        {
          "type": "text",
          "pattern": "current reduced",
          "flags": "i"
        },
        {
          "type": "text",
          "pattern": "reduced current",
          "flags": "i"
        },
        {
          "type": "text",
          "pattern": "charge current reduced",
          "flags": "i"
        },
        {
          "type": "numericComparison",
          "leftTokens": [
            "charge_current_ma",
            "current_ma"
          ],
          "operator": "lt",
          "rightTokens": [
            "requested_ma"
          ]
        }
      ],
      "stageId": "pattern",
      "inference": "Requested charge current was reduced by the controller.",
      "suggestedAction": "Compare requested and delivered current around the event window.",
      "analysis": {
        "conclusion": {
          "value": "The log indicates charge current reduction without a confirmed root cause.",
          "priority": 3
        },
        "severity": {
          "value": "Warning",
          "priority": 1
        },
        "suggestedActions": [
          {
            "value": "Compare requested and delivered current around the event window.",
            "priority": 0
          }
        ]
      }
    },
    {
      "id": "communication-timeout",
      "name": "通信超时",
      "anyOf": [
        {
          "type": "text",
          "pattern": "timeout",
          "flags": "i"
        },
        {
          "type": "text",
          "pattern": "retry",
          "flags": "i"
        },
        {
          "type": "text",
          "pattern": "E_TIMEOUT",
          "flags": "i"
        }
      ],
      "stageId": "pattern",
      "inference": "Controller communication showed timeout or retry behavior.",
      "suggestedAction": "Check network latency, controller availability, and retry counts.",
      "analysis": {
        "conclusion": {
          "value": "The log indicates communication timeout or retry behavior.",
          "priority": 2
        },
        "impact": {
          "value": "Intermittent communication may delay diagnostics or hide the underlying device state.",
          "priority": 2
        },
        "severity": {
          "value": "Warning",
          "priority": 1
        },
        "confidence": {
          "value": 0.72,
          "priority": 1
        },
        "suggestedActions": [
          {
            "value": "Check network latency, controller availability, and retry counts.",
            "priority": 0
          }
        ]
      }
    },
    {
      "id": "device-offline",
      "name": "设备离线",
      "anyOf": [
        {
          "type": "text",
          "pattern": "offline",
          "flags": "i"
        },
        {
          "type": "text",
          "pattern": "disconnect",
          "flags": "i"
        },
        {
          "type": "text",
          "pattern": "DEVICE_UNAVAILABLE",
          "flags": "i"
        }
      ],
      "stageId": "rootcause",
      "inference": "The device became unavailable or disconnected.",
      "suggestedAction": "Verify device power, link status, and reconnect behavior.",
      "analysis": {
        "conclusion": {
          "value": "The log indicates the device went offline or became unavailable.",
          "priority": 1
        },
        "impact": {
          "value": "Device availability may block reads, writes, or continued charging diagnostics.",
          "priority": 0
        },
        "severity": {
          "value": "Critical",
          "priority": 0,
          "requiresErrorEvidence": true
        },
        "confidence": {
          "value": 0.85,
          "priority": 0,
          "requiresErrorEvidence": true
        },
        "suggestedActions": [
          {
            "value": "Verify device power, link status, and reconnect behavior.",
            "priority": 0
          }
        ]
      }
    },
    {
      "id": "error-code",
      "name": "错误码",
      "anyOf": [
        {
          "type": "severityToken",
          "severity": "error",
          "token": "code"
        }
      ],
      "stageId": "pattern",
      "inference": "Error lines include explicit machine-readable error codes.",
      "suggestedAction": "Use the error code to correlate firmware diagnostics and incident history.",
      "analysis": {
        "conclusion": {
          "value": "The log contains explicit error codes that need follow-up.",
          "priority": 4
        },
        "severity": {
          "value": "Warning",
          "priority": 1
        },
        "suggestedActions": [
          {
            "value": "Correlate the error code with firmware diagnostics and recent parameter changes.",
            "priority": 1
          }
        ]
      }
    }
  ],
  "noHit": {
    "confidence": 0.42,
    "conclusion": "No rule-based log findings were detected.",
    "impact": "No immediate operational impact was identified from the provided lines.",
    "severity": "Info",
    "suggestedActions": [
      "Collect more context from the device and adjacent logs before escalating."
    ]
  },
  "hitDefaults": {
    "confidence": 0.64,
    "conclusion": "No rule-based log findings were detected.",
    "impact": "The finding may require operator review before closing the incident.",
    "severity": "Info",
    "suggestedActions": []
  }
}$original_rules$::jsonb;
  charging_rules jsonb := $rules${
  "rules": [
    {
      "id": "thermal-foldback",
      "anyOf": [
        {
          "type": "text",
          "pattern": "\\bfoldback\\b|THERMAL_FOLDBACK|\\bderat(?:e|ed|ing)\\b|\\b(?:battery_temp|temperature|thermal)\\b.*\\bexceeds? (?:the )?limit\\b",
          "flags": "i"
        }
      ],
      "stageId": "rootcause",
      "inference": "过热保护降低了充电输出。",
      "suggestedAction": "恢复快充前，请检查电池温度、散热路径及电池管理系统的温度保护阈值。",
      "analysis": {
        "conclusion": {
          "value": "充电表现符合过热保护降额特征。",
          "priority": 0
        },
        "impact": {
          "value": "电池温度恢复到安全范围前，充电速度可能降低。",
          "priority": 1
        },
        "severity": {
          "value": "Warning",
          "priority": 1
        },
        "confidence": {
          "value": 0.85,
          "priority": 0,
          "requiresErrorEvidence": true
        },
        "suggestedActions": [
          {
            "value": "恢复快充前，请检查电池温度、散热路径及电池管理系统的温度保护阈值。",
            "priority": 0
          },
          {
            "value": "检查环境温度和近期请求的充电电流，确认是否存在过热风险。",
            "priority": 2
          }
        ]
      },
      "name": "热降额"
    },
    {
      "id": "charge-current-reduction",
      "anyOf": [
        {
          "type": "text",
          "pattern": "current reduced",
          "flags": "i"
        },
        {
          "type": "text",
          "pattern": "reduced current",
          "flags": "i"
        },
        {
          "type": "text",
          "pattern": "charge current reduced",
          "flags": "i"
        },
        {
          "type": "numericComparison",
          "leftTokens": [
            "charge_current_ma",
            "current_ma"
          ],
          "operator": "lt",
          "rightTokens": [
            "requested_ma"
          ]
        }
      ],
      "stageId": "pattern",
      "inference": "控制器降低了请求的充电电流。",
      "suggestedAction": "对比异常发生前后请求的充电电流与实际电流。",
      "analysis": {
        "conclusion": {
          "value": "日志显示充电电流降低，具体原因尚未确认。",
          "priority": 3
        },
        "severity": {
          "value": "Warning",
          "priority": 1
        },
        "suggestedActions": [
          {
            "value": "对比异常发生前后请求的充电电流与实际电流。",
            "priority": 0
          }
        ]
      },
      "name": "充电限流"
    },
    {
      "id": "communication-timeout",
      "anyOf": [
        {
          "type": "text",
          "pattern": "\\btimeout\\b|\\btimed out\\b|\\bretry[=: ]+[1-9][0-9]*\\b|\\bretry (?:request|connection|after|due|attempt|scheduled)\\b|\\b(?:scheduling|scheduled) (?:a )?retry\\b|\\bretrying\\b|E_TIMEOUT",
          "flags": "i"
        }
      ],
      "stageId": "pattern",
      "inference": "控制器通信出现超时或重试。",
      "suggestedAction": "检查网络延迟、控制器连接状态和重试次数。",
      "analysis": {
        "conclusion": {
          "value": "日志显示通信超时或重试。",
          "priority": 2
        },
        "impact": {
          "value": "通信不稳定可能延迟诊断，或导致无法获取设备的实际状态。",
          "priority": 2
        },
        "severity": {
          "value": "Warning",
          "priority": 1
        },
        "confidence": {
          "value": 0.72,
          "priority": 1
        },
        "suggestedActions": [
          {
            "value": "检查网络延迟、控制器连接状态和重试次数。",
            "priority": 0
          }
        ]
      },
      "name": "通信超时"
    },
    {
      "id": "device-offline",
      "anyOf": [
        {
          "type": "text",
          "pattern": "\\boffline\\b",
          "flags": "i"
        },
        {
          "type": "text",
          "pattern": "\\bdisconnect(?:ed|ion)?\\b",
          "flags": "i"
        },
        {
          "type": "text",
          "pattern": "DEVICE_UNAVAILABLE",
          "flags": "i"
        }
      ],
      "stageId": "rootcause",
      "inference": "设备不可用或连接已断开。",
      "suggestedAction": "检查设备供电、连接状态及能否重新连接。",
      "analysis": {
        "conclusion": {
          "value": "日志显示设备离线或不可用。",
          "priority": 1
        },
        "impact": {
          "value": "设备不可用可能阻碍读写操作或后续充电诊断。",
          "priority": 0
        },
        "severity": {
          "value": "Critical",
          "priority": 0,
          "requiresErrorEvidence": true
        },
        "confidence": {
          "value": 0.85,
          "priority": 0,
          "requiresErrorEvidence": true
        },
        "suggestedActions": [
          {
            "value": "检查设备供电、连接状态及能否重新连接。",
            "priority": 0
          }
        ]
      },
      "name": "设备离线"
    },
    {
      "id": "error-code",
      "anyOf": [
        {
          "type": "severityToken",
          "severity": "error",
          "token": "code"
        }
      ],
      "stageId": "pattern",
      "inference": "错误日志中包含明确的错误码。",
      "suggestedAction": "根据错误码核对固件诊断结果和历史故障。",
      "analysis": {
        "conclusion": {
          "value": "日志包含需要进一步排查的错误码。",
          "priority": 4
        },
        "severity": {
          "value": "Warning",
          "priority": 1
        },
        "suggestedActions": [
          {
            "value": "根据错误码核对固件诊断结果和近期参数变更。",
            "priority": 1
          }
        ]
      },
      "name": "错误码"
    }
  ],
  "noHit": {
    "confidence": 0.42,
    "conclusion": "未发现符合已知规则的异常。",
    "impact": "所提供的日志尚未显示直接的运行影响。",
    "severity": "Info",
    "suggestedActions": [
      "进一步处理前，请收集设备状态及相邻时段的日志。"
    ]
  },
  "hitDefaults": {
    "confidence": 0.64,
    "conclusion": "未发现符合已知规则的异常。",
    "impact": "关闭故障记录前，可能需要人工复核分析结果。",
    "severity": "Info",
    "suggestedActions": []
  }
}$rules$::jsonb;
  original_spec jsonb;
  localized_spec jsonb;
  revision_id text;
begin
  original_spec := jsonb_build_object('schemaVersion', 'skill/v1', 'signalRules', original_rules);
  for skill in
    select d.id, d.organization_id, r.id as original_revision_id, r.spec
    from log_domains d
    join log_skill_revisions r on (r.skill_id, r.organization_id) = (d.id, d.organization_id)
    cross join lateral (select case when length(substring(d.name from '[0-9]+')) >= 2
      then substring(d.name from '[0-9]+') else 'skill-' || left(md5(d.id), 8) end as base_key) generated
    where d.id = 'seed-charging:' || d.organization_id
      and r.id = 'seed-charging-revision:' || d.organization_id
      and r.status = 'published' and r.revision_number = 1
      and r.created_by_user_id is null and r.published_by_user_id is null
      and r.content_hash = encode(sha256(convert_to(r.spec::text, 'UTF8')), 'hex')
      -- 0197 added this empty array to every then-current publication.
      and (r.spec = original_spec or r.spec = original_spec || '{"knowledgeEntryIds":[]}'::jsonb)
      and d.description = 'Charging analysis with the original charging signal rules.'
      and d.name ~ '^充电( \(([2-9]|[1-9][0-9]+)\))?$'
      -- 0202 derives numeric keys for suffixes >=10; collisions append the id hash and retry count.
      and d.skill_key ~ ('^' || generated.base_key || '(-' || left(md5(d.id), 8) || '(-([2-9]|[1-9][0-9]+))?)?$')
      and d.status = 'active' and d.updated_at = d.created_at
      and d.format_profile is null and d.model_override is null
      and d.webhook_url is null and d.webhook_secret is null
      and d.webhook_secret_last_four is null and not d.webhook_secret_encrypted and not d.webhook_enabled
      and not exists (select 1 from log_skill_revisions other
        where other.skill_id = d.id and other.organization_id = d.organization_id and other.id <> r.id)
      and not exists (select 1 from audit_events authored
        where authored.organization_id = d.organization_id and authored.target_id = d.id and authored.actor_type <> 'system')
    order by d.organization_id
    for update of d, r
  loop
    revision_id := 'seed-charging-revision-0208:' || skill.organization_id;
    localized_spec := skill.spec || jsonb_build_object('signalRules', charging_rules);
    update log_skill_revisions set status = 'superseded'
      where id = skill.original_revision_id and organization_id = skill.organization_id and status = 'published';
    insert into log_skill_revisions
      (id, organization_id, skill_id, revision_number, status, spec, content_hash, published_at)
      values (revision_id, skill.organization_id, skill.id, 2, 'published', localized_spec,
        encode(sha256(convert_to(localized_spec::text, 'UTF8')), 'hex'), now());
    update log_domains set description = '根据充电异常规则分析日志。', updated_at = now()
      where id = skill.id and organization_id = skill.organization_id;
    insert into audit_events
      (id, organization_id, actor_user_id, actor_type, app, kind, action, severity,
       target_type, target_id, metadata, trace_id)
      values ('seed-charging-audit-0208:' || skill.organization_id, skill.organization_id,
        null, 'system', 'log-analysis', 'log-skill-publish', 'log-skill-publish', 'Medium',
        'log-skill', skill.id, jsonb_build_object('initiator', 'system', 'systemKind', 'service',
          'systemName', '0208-localize-seed-charging-skill', 'revisionId', revision_id,
          'previousRevisionId', skill.original_revision_id), '0208-localize-seed-charging-skill');
  end loop;
end
$localize$;

