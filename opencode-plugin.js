export const PromptGraph = async () => {
  return {
    config: async (config) => {
      config.mcp = config.mcp || {};
      config.mcp.promptgraph = {
        type: 'local',
        command: ['npx', 'promptgraph-mcp'],
        enabled: true,
      };
    },
  };
};

export default PromptGraph;
