# Databricks notebook source
# MAGIC %md
# MAGIC #Tool-calling Agent
# MAGIC
# MAGIC This is an auto-generated notebook created by an AI playground export. In this notebook, you will:
# MAGIC - Author a tool-calling [MLflow's `ResponsesAgent`](https://mlflow.org/docs/latest/api_reference/python_api/mlflow.pyfunc.html#mlflow.pyfunc.ResponsesAgent) that uses the OpenAI client
# MAGIC - Manually test the agent's output
# MAGIC - Evaluate the agent with Mosaic AI Agent Evaluation
# MAGIC - Log and deploy the agent
# MAGIC
# MAGIC This notebook should be run on serverless or a cluster with DBR<17.
# MAGIC
# MAGIC  **_NOTE:_**  This notebook uses the OpenAI SDK, but AI Agent Framework is compatible with any agent authoring framework, including LlamaIndex or LangGraph. To learn more, see the [Authoring Agents](https://docs.databricks.com/generative-ai/agent-framework/author-agent) Databricks documentation.
# MAGIC
# MAGIC ## Prerequisites
# MAGIC
# MAGIC - Address all `TODO`s in this notebook.

# COMMAND ----------

# MAGIC %pip install -U -qqqq backoff databricks-openai uv databricks-agents mlflow-skinny[databricks]
# MAGIC dbutils.library.restartPython()

# COMMAND ----------

# MAGIC %md ## Define the agent in code
# MAGIC Below we define our agent code in a single cell, enabling us to easily write it to a local Python file for subsequent logging and deployment using the `%%writefile` magic command.
# MAGIC
# MAGIC For more examples of tools to add to your agent, see [docs](https://docs.databricks.com/generative-ai/agent-framework/agent-tool.html).

# COMMAND ----------

# MAGIC %%writefile agent.py
# MAGIC import json
# MAGIC from typing import Any, Callable, Generator, Optional
# MAGIC from uuid import uuid4
# MAGIC import warnings
# MAGIC
# MAGIC import backoff
# MAGIC import mlflow
# MAGIC import openai
# MAGIC from databricks.sdk import WorkspaceClient
# MAGIC from databricks_openai import UCFunctionToolkit, VectorSearchRetrieverTool
# MAGIC from mlflow.entities import SpanType
# MAGIC from mlflow.pyfunc import ResponsesAgent
# MAGIC from mlflow.types.responses import (
# MAGIC     ResponsesAgentRequest,
# MAGIC     ResponsesAgentResponse,
# MAGIC     ResponsesAgentStreamEvent,
# MAGIC     output_to_responses_items_stream,
# MAGIC     to_chat_completions_input,
# MAGIC )
# MAGIC from openai import OpenAI
# MAGIC from pydantic import BaseModel
# MAGIC from unitycatalog.ai.core.base import get_uc_function_client
# MAGIC
# MAGIC ############################################
# MAGIC # Define your LLM endpoint and system prompt
# MAGIC ############################################
# MAGIC LLM_ENDPOINT_NAME = "databricks-gpt-5-2"
# MAGIC
# MAGIC SYSTEM_PROMPT = """You are a expert safety agent. Use lidar points around a workorder location to determine any safety hazards or special equipment needed"""
# MAGIC
# MAGIC
# MAGIC ###############################################################################
# MAGIC ## Define tools for your agent, enabling it to retrieve data or take actions
# MAGIC ## beyond text generation
# MAGIC ## To create and see usage examples of more tools, see
# MAGIC ## https://docs.databricks.com/generative-ai/agent-framework/agent-tool.html
# MAGIC ###############################################################################
# MAGIC class ToolInfo(BaseModel):
# MAGIC     """
# MAGIC     Class representing a tool for the agent.
# MAGIC     - "name" (str): The name of the tool.
# MAGIC     - "spec" (dict): JSON description of the tool (matches OpenAI Responses format)
# MAGIC     - "exec_fn" (Callable): Function that implements the tool logic
# MAGIC     """
# MAGIC
# MAGIC     name: str
# MAGIC     spec: dict
# MAGIC     exec_fn: Callable
# MAGIC
# MAGIC
# MAGIC def create_tool_info(tool_spec, exec_fn_param: Optional[Callable] = None):
# MAGIC     tool_spec["function"].pop("strict", None)
# MAGIC     tool_name = tool_spec["function"]["name"]
# MAGIC     udf_name = tool_name.replace("__", ".")
# MAGIC
# MAGIC     # Define a wrapper that accepts kwargs for the UC tool call,
# MAGIC     # then passes them to the UC tool execution client
# MAGIC     def exec_fn(**kwargs):
# MAGIC         function_result = uc_function_client.execute_function(udf_name, kwargs)
# MAGIC         if function_result.error is not None:
# MAGIC             return function_result.error
# MAGIC         else:
# MAGIC             return function_result.value
# MAGIC     return ToolInfo(name=tool_name, spec=tool_spec, exec_fn=exec_fn_param or exec_fn)
# MAGIC
# MAGIC
# MAGIC TOOL_INFOS = []
# MAGIC
# MAGIC # You can use UDFs in Unity Catalog as agent tools
# MAGIC # TODO: Add additional tools
# MAGIC UC_TOOL_NAMES = []
# MAGIC
# MAGIC uc_toolkit = UCFunctionToolkit(function_names=UC_TOOL_NAMES)
# MAGIC uc_function_client = get_uc_function_client()
# MAGIC for tool_spec in uc_toolkit.tools:
# MAGIC     TOOL_INFOS.append(create_tool_info(tool_spec))
# MAGIC
# MAGIC
# MAGIC # Use Databricks vector search indexes as tools
# MAGIC # See [docs](https://docs.databricks.com/generative-ai/agent-framework/unstructured-retrieval-tools.html) for details
# MAGIC
# MAGIC # # (Optional) Use Databricks vector search indexes as tools
# MAGIC # # See https://docs.databricks.com/generative-ai/agent-framework/unstructured-retrieval-tools.html
# MAGIC # # for details
# MAGIC VECTOR_SEARCH_TOOLS = []
# MAGIC # # TODO: Add vector search indexes as tools or delete this block
# MAGIC # VECTOR_SEARCH_TOOLS.append(
# MAGIC #         VectorSearchRetrieverTool(
# MAGIC #         index_name="",
# MAGIC #         # filters="..."
# MAGIC #     )
# MAGIC # )
# MAGIC for vs_tool in VECTOR_SEARCH_TOOLS:
# MAGIC     TOOL_INFOS.append(create_tool_info(vs_tool.tool, vs_tool.execute))
# MAGIC
# MAGIC
# MAGIC
# MAGIC class ToolCallingAgent(ResponsesAgent):
# MAGIC     """
# MAGIC     Class representing a tool-calling Agent
# MAGIC     """
# MAGIC
# MAGIC     def __init__(self, llm_endpoint: str, tools: list[ToolInfo]):
# MAGIC         """Initializes the ToolCallingAgent with tools."""
# MAGIC         self.llm_endpoint = llm_endpoint
# MAGIC         self.workspace_client = WorkspaceClient()
# MAGIC         self.model_serving_client: OpenAI = (
# MAGIC             self.workspace_client.serving_endpoints.get_open_ai_client()
# MAGIC         )
# MAGIC         self._tools_dict = {tool.name: tool for tool in tools}
# MAGIC
# MAGIC     def get_tool_specs(self) -> list[dict]:
# MAGIC         """Returns tool specifications in the format OpenAI expects."""
# MAGIC         return [tool_info.spec for tool_info in self._tools_dict.values()]
# MAGIC
# MAGIC     @mlflow.trace(span_type=SpanType.TOOL)
# MAGIC     def execute_tool(self, tool_name: str, args: dict) -> Any:
# MAGIC         """Executes the specified tool with the given arguments."""
# MAGIC         return self._tools_dict[tool_name].exec_fn(**args)
# MAGIC
# MAGIC     def call_llm(self, messages: list[dict[str, Any]]) -> Generator[dict[str, Any], None, None]:
# MAGIC         with warnings.catch_warnings():
# MAGIC             warnings.filterwarnings("ignore", message="PydanticSerializationUnexpectedValue")
# MAGIC             for chunk in self.model_serving_client.chat.completions.create(
# MAGIC                 model=self.llm_endpoint,
# MAGIC                 messages=to_chat_completions_input(messages),
# MAGIC                 tools=self.get_tool_specs(),
# MAGIC                 stream=True,
# MAGIC             ):
# MAGIC                 chunk_dict = chunk.to_dict()
# MAGIC                 if len(chunk_dict.get("choices", [])) > 0:
# MAGIC                     yield chunk_dict
# MAGIC
# MAGIC     def handle_tool_call(
# MAGIC         self,
# MAGIC         tool_call: dict[str, Any],
# MAGIC         messages: list[dict[str, Any]],
# MAGIC     ) -> ResponsesAgentStreamEvent:
# MAGIC         """
# MAGIC         Execute tool calls, add them to the running message history, and return a ResponsesStreamEvent w/ tool output
# MAGIC         """
# MAGIC         try:
# MAGIC             args = json.loads(tool_call.get("arguments"))
# MAGIC         except Exception as e:
# MAGIC             args = {}
# MAGIC         result = str(self.execute_tool(tool_name=tool_call["name"], args=args))
# MAGIC
# MAGIC         tool_call_output = self.create_function_call_output_item(tool_call["call_id"], result)
# MAGIC         messages.append(tool_call_output)
# MAGIC         return ResponsesAgentStreamEvent(type="response.output_item.done", item=tool_call_output)
# MAGIC
# MAGIC     def call_and_run_tools(
# MAGIC         self,
# MAGIC         messages: list[dict[str, Any]],
# MAGIC         max_iter: int = 10,
# MAGIC     ) -> Generator[ResponsesAgentStreamEvent, None, None]:
# MAGIC         for _ in range(max_iter):
# MAGIC             last_msg = messages[-1]
# MAGIC             if last_msg.get("role", None) == "assistant":
# MAGIC                 return
# MAGIC             elif last_msg.get("type", None) == "function_call":
# MAGIC                 yield self.handle_tool_call(last_msg, messages)
# MAGIC             else:
# MAGIC                 yield from output_to_responses_items_stream(
# MAGIC                     chunks=self.call_llm(messages), aggregator=messages
# MAGIC                 )
# MAGIC
# MAGIC         yield ResponsesAgentStreamEvent(
# MAGIC             type="response.output_item.done",
# MAGIC             item=self.create_text_output_item("Max iterations reached. Stopping.", str(uuid4())),
# MAGIC         )
# MAGIC
# MAGIC     def predict(self, request: ResponsesAgentRequest) -> ResponsesAgentResponse:
# MAGIC         session_id = None
# MAGIC         if request.custom_inputs and "session_id" in request.custom_inputs:
# MAGIC             session_id = request.custom_inputs.get("session_id")
# MAGIC         elif request.context and request.context.conversation_id:
# MAGIC             session_id = request.context.conversation_id
# MAGIC
# MAGIC         if session_id:
# MAGIC             mlflow.update_current_trace(
# MAGIC                 metadata={
# MAGIC                     "mlflow.trace.session": session_id,
# MAGIC                 }
# MAGIC             )
# MAGIC
# MAGIC         outputs = [
# MAGIC             event.item
# MAGIC             for event in self.predict_stream(request)
# MAGIC             if event.type == "response.output_item.done"
# MAGIC         ]
# MAGIC         return ResponsesAgentResponse(output=outputs, custom_outputs=request.custom_inputs)
# MAGIC
# MAGIC     def predict_stream(self, request: ResponsesAgentRequest) -> Generator[ResponsesAgentStreamEvent, None, None]:
# MAGIC         session_id = None
# MAGIC         if request.custom_inputs and "session_id" in request.custom_inputs:
# MAGIC             session_id = request.custom_inputs.get("session_id")
# MAGIC         elif request.context and request.context.conversation_id:
# MAGIC             session_id = request.context.conversation_id
# MAGIC
# MAGIC         if session_id:
# MAGIC             mlflow.update_current_trace(
# MAGIC                 metadata={
# MAGIC                     "mlflow.trace.session": session_id,
# MAGIC                 }
# MAGIC             )
# MAGIC
# MAGIC         messages = to_chat_completions_input([i.model_dump() for i in request.input])
# MAGIC         if SYSTEM_PROMPT:
# MAGIC             messages.insert(0, {"role": "system", "content": SYSTEM_PROMPT})
# MAGIC         yield from self.call_and_run_tools(messages=messages)
# MAGIC
# MAGIC
# MAGIC # Log the model using MLflow
# MAGIC mlflow.openai.autolog()
# MAGIC AGENT = ToolCallingAgent(llm_endpoint=LLM_ENDPOINT_NAME, tools=TOOL_INFOS)
# MAGIC mlflow.models.set_model(AGENT)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Test the agent
# MAGIC
# MAGIC Interact with the agent to test its output. Since we manually traced methods within `ResponsesAgent`, you can view the trace for each step the agent takes, with any LLM calls made via the OpenAI SDK automatically traced by autologging.
# MAGIC
# MAGIC Replace this placeholder input with an appropriate domain-specific example for your agent.

# COMMAND ----------

dbutils.library.restartPython()

# COMMAND ----------

from agent import AGENT

AGENT.predict(
    {"input": [{"role": "user", "content": "what is 4*3 in python"}], "custom_inputs": {"session_id": "test-session-123"}},
)

# COMMAND ----------

for chunk in AGENT.predict_stream(
    {"input": [{"role": "user", "content": "What is 4*3 in Python?"}], "custom_inputs": {"session_id": "test-session-123"}}
):
    print(chunk.model_dump(exclude_none=True))

# COMMAND ----------

# MAGIC %md
# MAGIC ### Log the `agent` as an MLflow model
# MAGIC Determine Databricks resources to specify for automatic auth passthrough at deployment time
# MAGIC - **TODO**: If your Unity Catalog Function queries a [vector search index](https://docs.databricks.com/generative-ai/agent-framework/unstructured-retrieval-tools.html) or leverages [external functions](https://docs.databricks.com/generative-ai/agent-framework/external-connection-tools.html), you need to include the dependent vector search index and UC connection objects, respectively, as resources. See [docs](https://docs.databricks.com/generative-ai/agent-framework/log-agent.html#specify-resources-for-automatic-authentication-passthrough) for more details.
# MAGIC
# MAGIC Log the agent as code from the `agent.py` file. See [MLflow - Models from Code](https://mlflow.org/docs/latest/models.html#models-from-code).

# COMMAND ----------

# Determine Databricks resources to specify for automatic auth passthrough at deployment time
import mlflow
from agent import LLM_ENDPOINT_NAME, VECTOR_SEARCH_TOOLS, uc_toolkit
from mlflow.models.resources import DatabricksFunction, DatabricksServingEndpoint
from pkg_resources import get_distribution

resources = [DatabricksServingEndpoint(endpoint_name=LLM_ENDPOINT_NAME)]
for tool in VECTOR_SEARCH_TOOLS:
    resources.extend(tool.resources)
for tool in uc_toolkit.tools:
    # TODO: If the UC function includes dependencies like external connection or vector search, please include them manually.
    # See the TODO in the markdown above for more information.
    udf_name = tool.get("function", {}).get("name", "").replace("__", ".")
    resources.append(DatabricksFunction(function_name=udf_name))

input_example = {
    "input": [
        {
            "role": "user",
            "content": "Lat/Long: 38.49085855867861, -121.16159794115157"
        }
    ],
    "custom_inputs": {
        "session_id": "test-session"
    }
}

with mlflow.start_run():
    logged_agent_info = mlflow.pyfunc.log_model(
        name="agent",
        python_model="agent.py",
        input_example=input_example,
        pip_requirements=[
            "databricks-openai",
            "backoff",
            f"databricks-connect=={get_distribution('databricks-connect').version}",
        ],
        resources=resources,
    )

# COMMAND ----------

# MAGIC %md
# MAGIC ## Evaluate the agent with [Agent Evaluation](https://docs.databricks.com/mlflow3/genai/eval-monitor)
# MAGIC
# MAGIC You can edit the requests or expected responses in your evaluation dataset and run evaluation as you iterate your agent, leveraging mlflow to track the computed quality metrics.
# MAGIC
# MAGIC Evaluate your agent with one of our [predefined LLM scorers](https://docs.databricks.com/mlflow3/genai/eval-monitor/predefined-judge-scorers), or try adding [custom metrics](https://docs.databricks.com/mlflow3/genai/eval-monitor/custom-scorers).

# COMMAND ----------

import mlflow
from mlflow.genai.scorers import RelevanceToQuery, Safety, RetrievalRelevance, RetrievalGroundedness

eval_dataset = [
    {
        "inputs": {
            "input": [
                {
                    "role": "user",
                    "content": "Lat/Long: 38.49085855867861, -121.16159794115157"
                }
            ]
        },
        "expected_response": None
    },
    {
        "inputs": {
            "input": [
                {
                    "role": "user",
                    "content": "Lat/Long: 38.49085855867861, -121.16159794115157"
                },
                {
                    "role": "assistant",
                    "content": "Retrieve LiDAR point cloud around the provided workorder latitude/longitude to assess nearby terrain/objects (e.g., overhead lines, trees, structures, slopes) and infer safety hazards and required special equipment.\n\n<tool_call>{\"id\":\"VSBBt1DJxU5Ki1oEdXPV\",\"name\":\"stable_classic_sdir2v_catalog__gold_lidar__get_points_around_latlng\",\"arguments\":\"{\\\"input_lat\\\":38.49085855867861,\\\"input_lng\\\":-121.16159794115157}\"}</tool_call>\n\n<tool_call_result>{\"id\":\"VSBBt1DJxU5Ki1oEdXPV\",\"content\":\"{\\\"is_truncated\\\":true,\\\"columns\\\":[\\\"x\\\",\\\"y\\\",\\\"z\\\",\\\"distance_meters\\\"],\\\"rows\\\":[[660358.76,4261847.75,119.72,47.43508426688504],[660301.27,4261857.16,116.27,42.18434771381996],[660302.42,4261869.67,136.12,34.232903059284816],[660353.71,4261868.5200000005,108.69,28.216480430967007],[660331.49,4261865.68,122.01,16.28214799041059],[660349.77,4261868.14,111.09,24.648081989551017],[660326.1900000001,4261874.09,129.69,8.935989036964358],[660300.43,4261880.3100000005,116.67,34.33636482701787],[660305.5700000001,4261880.72,116.96000000000001,28.61763521416099],[660324.09,4261888.07,130.02,11.776754051414242],[660336.84,4261893.13,107.74000000000001,15.56811761864858],[660348.5700000001,4261893.22,103.05,24.035614347681943],[660300.79,4261899.96,100.10000000000001,40.38005653135775],[660357.79,4261864.93,117.98,34.126109407896394],[660339.01,4261873.43,115.52,11.523190526636787],[660354.09,4261873.14,103.77,26.626887327255638],[660346.35,4261869.83,144.65,20.439541311690768],[660353.5700000001,4261878.35,94.98,24.920683320706],[660302.5700000001,4261879.63,116.67,31.962636384830258],[660294.31,4261888.61,112.8,42.17634452278927],[660321.68,4261892.61,130.15,17.37107854720042],[660303.81,4261892.34,111.61,33.38130084745205],[660303.33,4261903.7700000005,95.34,40.62346368417153],[660325.0700000001,4261919.98,131.5,44.70936774726716],[660343.63,4261843.58,116.47,43.13791906935098],[660355.34,4261848.03,108.14,44.82226300082725],[660317.66,4261852.65,127.72,34.31433356672954],[660320.3,4261854.66,128.02,31.052399117887905],[660350.52,4261867.75,136.45,25.584494202737645],[660326.4500000001,4261872.0,129.4,10.68951440633189],[660319.16,4261872.99,129.17000000000002,15.751314760802924],[660344.75,4261890.12,100.56,18.564297899983064],[660331.08,4261901.3100000005,131.86,23.388330474852072],[660325.31,4261901.51,130.51,24.525116382125976],[660315.18,4261845.7,126.97,42.486266145529164],[660356.31,4261856.16,103.64,38.724248575149446],[660360.52,4261855.86,114.89,42.43722489109382],[660320.99,4261867.64,129.1,18.159850883516455],[660344.5,4261869.9,143.86,18.736416111348593],[660350.28,4261877.8,99.54,21.34550985490817],[660350.1,4261880.76,99.41,20.96857357309182],[660303.96,4261884.19,116.9,30.71270010787971],[660303.02,4261886.07,117.39,32.10143905860365],[660313.97,4261898.23,113.19,27.73729873782716],[660331.18,4261906.33,131.1,28.976415352769962],[660327.01,4261918.65,130.94,42.95515854035122],[660337.37,4261840.48,116.7,44.85297527514788],[660319.66,4261855.88,127.95,30.107415147279717],[660352.63,4261863.46,148.42000000000002,30.283323126899354],[660341.55,4261864.57,177.62,20.922905585841594],[660297.17,4261873.11,116.5,38.80124089025006],[660301.33,4261870.95,137.24,34.92296974449832],[660324.65,4261912.12,91.8,36.18129439708645],[660325.31,4261913.5,130.71,37.54993875314389],[660325.72,4261915.41,130.74,39.570829724754724],[660311.01,4261844.0600000005,125.56,46.227614783503704],[660353.7000000001,4261844.7,113.22,46.84737852827167],[660328.61,4261852.42,120.9,31.184076526437526],[660314.26,4261854.86,127.33,34.074624801076304],[660329.0700000001,4261854.99,121.10000000000001,28.288119859020448],[660314.15,4261865.41,127.17,25.264009791593544],[660315.37,4261866.09,128.12,23.744508728914283],[660323.3200000001,4261866.22,128.97,18.005549383096472],[660306.39,4261871.09,116.93,29.539024959333823],[660341.51,4261885.0200000005,108.66,12.55042204398304],[660289.64,4261889.5,107.38,47.466630108240615],[660309.41,4261897.38,137.93,30.88412487738771],[660324.8200000001,4261905.37,130.61,28.81688056147185],[660313.08,4261902.76,107.78,32.17546474371317],[660297.85,4261850.34,116.47,49.97297581564856],[660319.71,4261859.69,128.38,26.312316458916072],[660289.08,4261865.85,116.44,49.652295057738016],[660305.8,4261864.37,116.67,33.44892564996671],[660374.21,4261869.63,97.60000000000001,49.25925854374537],[660317.92,4261877.94,128.87,15.095363576425363],[660330.47,4261886.7700000005,127.43,7.254713843695114],[660333.33,4261896.5200000005,109.38,18.199447075178643],[660321.71,4261907.63,95.41,32.23205627877111],[660360.11,4261854.37,95.73,43.17911071641221],[660342.37,4261870.05,112.4,16.822184890403975],[660341.34,4261878.5,110.76,11.388051033134769],[660340.8,4261894.19,102.23,18.750136131861648],[660290.8200000001,4261892.87,104.13,47.15861653493563],[660302.26,4261908.91,90.68,45.36032466647857],[660356.21,4261862.26,107.74000000000001,34.26962333342439],[660296.61,4261865.24,142.29,42.07579185773612],[660348.1900000001,4261864.2,107.64,26.004000695590804],[660338.66,4261870.12,115.39,14.007090139478917],[660351.7000000001,4261874.36,137.37,23.6866474831773],[660348.02,4261892.91,98.62,23.33865629697009],[660341.39,4261901.59,90.42,26.24033232420755],[660324.86,4261908.8,130.61,32.51918538955957],[660294.14,4261861.16,116.47,46.50973041309118],[660330.76,4261858.97,119.75,23.757549000961745],[660320.02,4261867.67,128.87,18.834232581239622],[660328.04,4261870.26,128.64000000000001,11.745788110572914],[660301.31,4261878.64,116.67,33.407992904688015],[660330.84,4261889.73,122.47,10.506067624108146],[660293.7000000001,4261889.91,107.97,43.17478745479751],[660338.74,4261902.0600000005,100.95,25.609809868999605],[660315.49,4261907.7700000005,99.87,35.26749079674113],[660351.47,4261849.99,111.88,40.554238071261544],[660315.09,4261852.74,127.49000000000001,35.58395894316214],[660305.54,4261855.71,123.65,39.62753596035319],[660292.93,4261860.17,116.44,48.21352406419652],[660302.33,4261864.48,116.47,36.722357760873415],[660325.27,4261866.16,128.87,17.104837107829127],[660294.4,4261877.74,116.21000000000001,41.1487883397064],[660315.3,4261887.79,124.77,19.63792864055735],[660344.1,4261887.83,103.48,16.559276732548202],[660333.49,4261890.24,117.16,11.335293869225895],[660319.26,4261890.6,122.97,17.613595230893395],[660293.59,4261894.53,103.61,44.841992384431975],[660336.9500000001,4261908.34,90.12,31.847837088249815],[660327.39,4261922.38,131.07,47.04393151326184],[660303.79,4261849.35,125.92,46.083048066575266],[660358.12,4261848.59,105.22,46.2608996954189],[660360.4400000001,4261858.78,101.77,40.357890000637276],[660301.71,4261880.74,168.93,32.914900249473675],[660339.61,4261885.0600000005,110.27,10.687964358252543],[660296.39,4261887.57,116.37,39.667971853955336],[660315.99,4261896.11,138.88,24.477255685136452],[660331.56,4261902.32,132.45,24.513922789931677],[660331.76,4261908.58,131.2,31.485911808177057],[660324.4500000001,4261836.12,122.34,49.77297215152169],[660308.59,4261845.25,121.72,46.48268718203456],[660339.25,4261845.59,116.9,39.65469864000558],[660295.39,4261866.87,116.47,42.65527142472559],[660345.99,4261871.19,106.23,19.273349845748644],[660324.5,4261872.0600000005,129.2,11.876638716770314],[660316.76,4261870.6,128.54,19.434741110303925],[660289.54,4261876.65,116.27,46.638166654084415],[660375.03,4261877.6,100.2,48.810348129162314],[660374.08,4261881.2700000005,94.88,47.67197784511579],[660332.92,4261895.99,109.65,17.560678699343896],[660332.7000000001,4261924.61,131.36,49.353391161869844],[660334.92,4261837.57,116.67,47.74896012057322],[660336.4500000001,4261844.43,116.73,40.352464905313354],[660336.22,4261849.11,116.76,35.162410099536295],[660349.85,4261866.24,122.97,25.941631947842154],[660357.47,4261862.85,113.02,35.047289827225086],[660298.88,4261875.8100000005,116.57000000000001,36.40732153126596],[660348.6900000001,4261884.32,99.7,19.90157324838155],[660318.23,4261907.2,98.03,33.27912411724132],[660324.4400000001,4261911.0200000005,91.63,35.03322911607289],[660325.5700000001,4261852.43,126.28,31.67438142781087],[660296.24,4261864.67,116.44,42.70856460825777],[660355.78,4261868.35,115.49000000000001,30.358290818498176],[660351.81,4261868.8100000005,123.95,26.202869340178292],[660335.27,4261869.37,120.73,12.9607271736152],[660344.72,4261873.83,107.61,16.61685749963744],[660331.86,4261876.43,125.2,4.361628336732259],[660318.55,4261892.25,120.87,19.429257165440134],[660326.4400000001,4261909.11,130.77,32.51919883298632],[660354.13,4261847.19,110.17,44.79657375381161],[660331.67,4261853.88,122.87,29.4208935251107],[660360.9500000001,4261855.09,96.59,43.355707244516715],[660326.56,4261852.42,124.74000000000001,31.483014684423946],[660353.67,4261852.23,107.05,39.98370411653883],[660357.31,4261856.22,120.18,39.48785243513948],[660290.5700000001,4261866.3,116.57000000000001,47.92064608663097],[660295.67,4261867.7700000005,129.86,42.02019667731441],[660300.7000000001,4261867.57,132.71,36.870007147020175],[660290.14,4261864.85,116.5,48.917733230995495],[660358.62,4261867.17,129.66,33.77664986376047],[660311.15,4261873.36,120.9,23.697707013534615],[660301.79,4261883.26,116.93,32.98690669442194],[660315.74,4261899.34,110.79,27.352917608610028],[660325.09,4261900.93,130.45,23.973280421320318],[660301.9500000001,4261910.1,90.03,46.54157004481152],[660325.75,4261841.86,121.39,43.2388779835287],[660330.5,4261875.19,126.77,5.7570262239734316],[660374.43,4261878.87,91.63,48.07597355283083],[660315.36,4261897.57,112.4,26.140877217265423],[660301.77,4261898.7700000005,102.46000000000001,38.748625331643595],[660310.29,4261901.75,147.21,33.40305678914371],[660296.81,4261903.47,94.06,46.2301966765728],[660350.93,4261845.8,114.63,44.21074183247413],[660337.21,4261849.08,116.73,35.38468283466157],[660304.64,4261874.46,116.67,30.354550501286244],[660348.88,4261883.8,101.8,19.986967504653645],[660347.53,4261888.37,99.44,20.206681165136903],[660328.6900000001,4261890.84,130.68,12.077762190747112],[660312.74,4261894.9,149.21,26.26301628343576],[660314.78,4261897.3,131.79,26.366135556296022],[660345.36,4261895.1,112.57000000000001,22.746593205283606],[660316.52,4261915.14,90.55,42.118411604657915],[660343.7000000001,4261866.58,111.94,20.612959023430474],[660349.55,4261867.61,147.93,24.775554207562145],[660314.3,4261870.71,126.77,21.704222962520028],[660374.7000000001,4261875.0600000005,98.06,48.70118643267181],[660310.71,4261883.96,117.78,23.25059607519931],[660287.53,4261884.72,116.4,48.94590190465493],[660297.04,4261889.19,112.5,39.373875228105945],[660349.02,4261890.58,104.92,22.83339521541237],[660307.48,4261842.45,119.95,49.77555930168103],[660316.68,4261841.51,126.84,46.14345184925592],[660322.75,4261862.99,128.71,21.483361435168174],[660301.6,4261879.67,116.54,33.04129451548414],[660336.22,4261888.98,113.81,11.120790972244087]]}\"}</tool_call_result>\n\n### Lidar-based safety scan (around 38.4908586, -121.1615979)\n\n**What the points show**\n- Point distances range from ~4 m to ~50 m from the workorder location.\n- Elevations (**z**) span roughly **90 m up to ~178 m** within this small radius.\n- There are multiple **very high returns (≈145–178 m)** close in (about **20–33 m** away), and also several **low returns (~90–105 m)** in the same general vicinity.\n\n**Interpretation / likely hazards**\n1. **Overhead utility / aerial crossing risk (HIGH)**\n   - The combination of **very high returns** near the site and nearby lower ground/roof-level returns is consistent with **overhead conductors crossing above lower terrain/structures**, or tall poles/trees adjacent to the work area.\n   - Treat as **potential energized overhead lines** until field-verified.\n\n2. **Steep grade / embankment or structure edge (MODERATE–HIGH)**\n   - The large elevation spread (~80+ m) within ~50 m suggests **rapid elevation change** (slope, cut/fill, ravine, or roadway/structure elevation differences).\n   - This raises risk of **slips/trips/falls**, equipment instability, and limited safe staging.\n\n3. **Working near tall vegetation/objects (MODERATE)**\n   - Returns around **140–170 m** can also be consistent with **tall trees**; that adds hazards from **falling limbs**, reduced visibility of lines, and difficult access.\n\n---\n\n## Required controls / special equipment (recommend)\n- **Overhead line safety**\n  - **Pre-job utility hazard assessment**; look up/confirm overhead facilities and maintain minimum approach distances.\n  - If any work at height or with long tools/booms: **utility locate/coordination** and consider **spotter/dedicated observer**.\n  - **Non-conductive fiberglass ladder** (avoid metal) if ladder use is possible.\n- **Access / terrain**\n  - **Wheel chocks**, and if parking on slope: stage vehicle **on the flattest available area**.\n  - If walking/working on slope: **traction footwear**, and consider **fall protection** if there are edges/drop-offs (field-verify).\n- **If using any lift/crane/pole/ladder**\n  - **Height control / boom limit plan**, and **exclusion zone** for overhead hazards.\n\n---\n\n### Field verification checklist (quick)\n- Are there **overhead lines** within 50 m and above the work zone? (assume yes until confirmed)\n- Is the immediate area **sloped/uneven** enough to affect footing or vehicle stabilization?\n- Are there **tall trees** overhanging the work area?\n\nIf you tell me the **type of work** (e.g., telecom drop, electrical, tree work, roof, trench, meter, etc.) and whether you’ll use a **ladder or lift**, I can narrow this into a job-specific PPE/equipment list and approach distances."
                },
                {
                    "role": "user",
                    "content": "lat/Long: 38.476747517841694, -121.16952072285667"
                }
            ]
        },
        "expected_response": None
    }
]

eval_results = mlflow.genai.evaluate(
    data=eval_dataset,
    predict_fn=lambda input: AGENT.predict({"input": input, "custom_inputs": {"session_id": "evaluation-session"}}),
    scorers=[RelevanceToQuery(), Safety()], # add more scorers here if they're applicable
)

# Review the evaluation results in the MLfLow UI (see console output)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Perform pre-deployment validation of the agent
# MAGIC Before registering and deploying the agent, we perform pre-deployment checks via the [mlflow.models.predict()](https://mlflow.org/docs/latest/python_api/mlflow.models.html#mlflow.models.predict) API. See [documentation](https://docs.databricks.com/machine-learning/model-serving/model-serving-debug.html#validate-inputs) for details

# COMMAND ----------

mlflow.models.predict(
    model_uri=f"runs:/{logged_agent_info.run_id}/agent",
    input_data={"input": [{"role": "user", "content": "Hello!"}], "custom_inputs": {"session_id": "validation-session"}},
    env_manager="uv",
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Register the model to Unity Catalog
# MAGIC
# MAGIC Update the `catalog`, `schema`, and `model_name` below to register the MLflow model to Unity Catalog.

# COMMAND ----------

mlflow.set_registry_uri("databricks-uc")

# TODO: define the catalog, schema, and model name for your UC model
catalog = ""
schema = ""
model_name = ""
UC_MODEL_NAME = f"{catalog}.{schema}.{model_name}"

# register the model to UC
uc_registered_model_info = mlflow.register_model(
    model_uri=logged_agent_info.model_uri, name=UC_MODEL_NAME
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Deploy the agent

# COMMAND ----------

from databricks import agents
# NOTE: pass scale_to_zero=True to agents.deploy() to enable scale-to-zero for cost savings.
# This is not recommended for production workloads, as capacity is not guaranteed when scaled to zero.
# Scaled to zero endpoints may take extra time to respond when queried, while they scale back up.
agents.deploy(UC_MODEL_NAME, uc_registered_model_info.version, tags = {"endpointSource": "playground"})

# COMMAND ----------

# MAGIC %md
# MAGIC ## Next steps
# MAGIC
# MAGIC After your agent is deployed, you can chat with it in AI playground to perform additional checks, share it with SMEs in your organization for feedback, or embed it in a production application. See [docs](https://docs.databricks.com/generative-ai/deploy-agent.html) for details