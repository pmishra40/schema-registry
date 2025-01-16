import argparse
import sys
import yaml
from pathlib import Path
from typing import Dict, Any, Optional, List
from jinja2 import Environment, FileSystemLoader, select_autoescape

class CodeGeneratorOptions:
    def __init__(self, schema: Path, output_dir: Path, include_event_bridge: bool = True):
        self.schema = schema
        self.output_dir = output_dir
        self.include_event_bridge = include_event_bridge

class PythonGenerator:
    def __init__(self):
        self.schema: Dict[str, Any] = {}
        self.output_dir: Optional[Path] = None
        self.include_event_bridge: bool = True
        
        # Set up Jinja environment
        template_dir = Path(__file__).parent / 'templates'
        print(f"Looking for templates in: {template_dir}")
        if not template_dir.exists():
            raise ValueError(f"Template directory not found: {template_dir}")
            
        # List available templates
        print("Available templates:")
        for template_file in template_dir.glob('*.template'):
            print(f"  - {template_file.name}")
            
        self.env = Environment(
            loader=FileSystemLoader(str(template_dir)),
            autoescape=select_autoescape(['html', 'xml']),
            trim_blocks=True,
            lstrip_blocks=True
        )
        
        # Test template loading
        try:
            for template_name in ['base.py.template', 'models.py.template']:
                template = self.env.get_template(template_name)
                print(f"Successfully loaded template: {template_name}")
        except Exception as e:
            print(f"Error loading templates: {str(e)}")

    def initialize(self, options: CodeGeneratorOptions) -> None:
        self.output_dir = options.output_dir
        self.include_event_bridge = options.include_event_bridge
        
        # Ensure output directory exists
        self.output_dir.mkdir(parents=True, exist_ok=True)

        try:
            with open(options.schema, 'r') as f:
                self.schema = yaml.safe_load(f)
            validate_spec(self.schema)
        except Exception as e:
            print(f"Error loading schema: {e}", file=sys.stderr)
            sys.exit(1)

    def _get_python_type(self, schema: Dict[str, Any], prop_name: str = None, required_fields: List[str] = None) -> str:
        """Get Python type for schema"""
        type_map = {
            'string': 'str',
            'integer': 'int',
            'number': 'float',
            'boolean': 'bool',
            'array': 'List',
            'object': 'Dict[str, Any]'
        }
        
        # Check if property is required
        is_required = required_fields is None or prop_name in required_fields
        
        # Get base type
        if schema.get('type') == 'array':
            base_type = f"List[{self._get_python_type({'type': schema['items'].get('type', 'string')})}]"
        else:
            base_type = type_map.get(schema.get('type', 'string'), 'Any')
        
        # Make optional if not required
        return base_type if is_required else f"Optional[{base_type}]"

    def _process_schema(self) -> Dict[str, Any]:
        """Process schema into template context"""
        models = []
        type_unions = []
        
        print("Processing schema components...")
        
        # Process each model
        for name, schema in self.schema.get('components', {}).get('schemas', {}).items():
            print(f"Processing model: {name}")
            model = {
                'name': name,
                'description': schema.get('description', f'Represents a {name}'),
                'properties': [],
                'validations': [],
                'methods': [],
                'model_validators': [],
                'required': schema.get('required', [])
            }
            
            # Process properties
            for prop_name, prop_schema in schema.get('properties', {}).items():
                if '$ref' in prop_schema:
                    ref_path = prop_schema['$ref'].split('/')
                    ref_name = ref_path[-1]
                    prop_type = ref_name
                else:
                    prop_type = self._get_python_type(prop_schema, prop_name, model['required'])
                
                description_parts = []
                if prop_schema.get('description'):
                    description_parts.append(prop_schema['description'])
                if prop_schema.get('format'):
                    if prop_schema['format'] == 'date':
                        description_parts.append('ISO 8601 date format (YYYY-MM-DD)')
                    elif prop_schema['format'] == 'date-time':
                        description_parts.append('ISO 8601 UTC date-time format (YYYY-MM-DDThh:mm:ss.sssZ)')
                
                prop = {
                    'name': prop_name,
                    'type': prop_type,
                    'description': '\n'.join(description_parts) if description_parts else None,
                    'required': prop_name in model['required'],
                    'default': prop_schema.get('default'),
                    'pattern': prop_schema.get('pattern'),
                    'format': prop_schema.get('format'),
                    'enum': prop_schema.get('enum'),
                    'minimum': prop_schema.get('minimum'),
                    'maximum': prop_schema.get('maximum')
                }
                model['properties'].append(prop)
                
                # Add validations
                validations = []
                
                # Pattern validation
                if prop_schema.get('pattern'):
                    validations.append({
                        'field': prop_name,
                        'code': f'if not re.match(r"{prop_schema["pattern"]}", v):\n'
                               f'    raise ValueError(f"{prop_name} must match pattern {prop_schema["pattern"]}")\n'
                               f'return v'
                    })
                
                # Enum validation
                if prop_schema.get('enum'):
                    validations.append({
                        'field': prop_name,
                        'code': f'if v not in {prop_schema["enum"]}:\n'
                               f'    raise ValueError(f"{prop_name} must be one of {prop_schema["enum"]}")\n'
                               f'return v'
                    })
                
                # Number validations
                if prop_schema.get('type') in ['integer', 'number']:
                    if 'minimum' in prop_schema:
                        validations.append({
                            'field': prop_name,
                            'code': f'if v < {prop_schema["minimum"]}:\n'
                                   f'    raise ValueError(f"{prop_name} must be >= {prop_schema["minimum"]}")\n'
                                   f'return v'
                        })
                    if 'maximum' in prop_schema:
                        validations.append({
                            'field': prop_name,
                            'code': f'if v > {prop_schema["maximum"]}:\n'
                                   f'    raise ValueError(f"{prop_name} must be <= {prop_schema["maximum"]}")\n'
                                   f'return v'
                        })
                
                # Format validations
                if prop_schema.get('format'):
                    if prop_schema['format'] == 'date-time':
                        validations.append({
                            'field': prop_name,
                            'code': 'try:\n'
                                   '    datetime.fromisoformat(v.replace("Z", "+00:00"))\n'
                                   '    return v\n'
                                   'except ValueError as e:\n'
                                   f'    raise ValueError(f"{prop_name} must be a valid ISO 8601 datetime")'
                        })
                    elif prop_schema['format'] == 'date':
                        validations.append({
                            'field': prop_name,
                            'code': 'try:\n'
                                   '    datetime.strptime(v, "%Y-%m-%d")\n'
                                   '    return v\n'
                                   'except ValueError as e:\n'
                                   f'    raise ValueError(f"{prop_name} must be a valid ISO 8601 date (YYYY-MM-DD)")'
                        })
                
                model['validations'].extend(validations)
            
            # Add model validators
            if 'x-model-validators' in schema:
                for validator in schema['x-model-validators']:
                    model['model_validators'].append({
                        'name': validator['name'],
                        'description': validator.get('description', ''),
                        'code': validator['code']
                    })
            
            models.append(model)
            
            # Check for unions
            if 'x-union-types' in schema:
                type_unions.append({
                    'name': f"{name}Types",
                    'description': f"Union of types for {name}",
                    'types': schema['x-union-types']
                })
        
        context = {
            'models': models,
            'type_unions': type_unions,
            're': True  # Indicate that re module is needed
        }
        return context

    def _generate_validator(self) -> List[str]:
        """Generate validator code"""
        code = [
            'from typing import Any, Dict, List, Optional',
            'from datetime import datetime',
            'from .models import *',
            '',
            'class ValidationError(Exception):',
            '    """Raised when event validation fails"""',
            '    pass',
            '',
            'class Validator:',
            '    """Validates events against schema"""',
            '',
            '    @staticmethod',
            '    def validate_event(event_type: str, event_data: Dict[str, Any]) -> None:',
            '        """',
            '        Validate event data against schema',
            '        :param event_type: Type of event (e.g., BillApproved)',
            '        :param event_data: Event data to validate',
            '        :raises: ValidationError if validation fails',
            '        """',
            '        try:',
            '            # Validate required fields',
            '            if "bill" not in event_data:',
            '                raise ValidationError("Missing required field: bill")',
            '            if "project" not in event_data:',
            '                raise ValidationError("Missing required field: project")',
            '            if "lineItems" not in event_data:',
            '                raise ValidationError("Missing required field: lineItems")',
            '            if "approval" not in event_data:',
            '                raise ValidationError("Missing required field: approval")',
            '            if "eventMetadata" not in event_data:',
            '                raise ValidationError("Missing required field: eventMetadata")',
            '',
            '            # Validate bill fields',
            '            bill = event_data["bill"]',
            '            required_bill_fields = [',
            '                "billId", "billNumber", "tradePartnerBillNumber",',
            '                "tradePartnerId", "billType", "billSource",',
            '                "billDate", "billStatus", "totalAmountInCents"',
            '            ]',
            '            for field in required_bill_fields:',
            '                if field not in bill:',
            '                    raise ValidationError(f"Missing required bill field: {field}")',
            '',
            '            # Validate date formats',
            '            date_fields = ["billDate", "dueDate", "paidDate", "postedDate"]',
            '            for field in date_fields:',
            '                if field in bill and bill[field]:',
            '                    try:',
            '                        datetime.strptime(bill[field], "%Y-%m-%d")',
            '                    except ValueError:',
            '                        raise ValidationError(f"Invalid date format for {field}. Expected YYYY-MM-DD")',
            '',
            '            # Validate integer fields',
            '            int_fields = ["totalAmountInCents", "amountPaidInCents"]',
            '            for field in int_fields:',
            '                if field in bill and bill[field] is not None:',
            '                    if not isinstance(bill[field], int):',
            '                        raise ValidationError(f"{field} must be an integer")',
            '',
            '            # Validate project fields',
            '            project = event_data["project"]',
            '            required_project_fields = [',
            '                "projectId", "projectName", "lotType", "projectStatus"',
            '            ]',
            '            for field in required_project_fields:',
            '                if field not in project:',
            '                    raise ValidationError(f"Missing required project field: {field}")',
            '',
            '            # Validate line items',
            '            line_items = event_data["lineItems"]',
            '            if not isinstance(line_items, list):',
            '                raise ValidationError("lineItems must be an array")',
            '',
            '            required_line_item_fields = [',
            '                "lineId", "amountInCents", "costCodeId",',
            '                "costCodeNumber", "costClassification"',
            '            ]',
            '            for item in line_items:',
            '                for field in required_line_item_fields:',
            '                    if field not in item:',
            '                        raise ValidationError(f"Missing required line item field: {field}")',
            '                if not isinstance(item["amountInCents"], int):',
            '                    raise ValidationError("Line item amountInCents must be an integer")',
            '',
            '            # Validate approval',
            '            approval = event_data["approval"]',
            '            if "approvalStatus" not in approval:',
            '                raise ValidationError("Missing required approval field: approvalStatus")',
            '',
            '            # Validate event metadata',
            '            metadata = event_data["eventMetadata"]',
            '            required_metadata_fields = [',
            '                "idempotencyKey", "correlationId",',
            '                "eventTimeStamp", "schemaVersion"',
            '            ]',
            '            for field in required_metadata_fields:',
            '                if field not in metadata:',
            '                    raise ValidationError(f"Missing required metadata field: {field}")',
            '',
            '            # Validate timestamp format',
            '            try:',
            '                datetime.strptime(metadata["eventTimeStamp"], "%Y-%m-%dT%H:%M:%S%z")',
            '            except ValueError:',
            '                raise ValidationError("Invalid eventTimeStamp format. Expected ISO 8601 UTC format")',
            '',
            '        except KeyError as e:',
            '            raise ValidationError(f"Missing required field: {str(e)}")',
            '        except Exception as e:',
            '            raise ValidationError(f"Validation error: {str(e)}")',
            ''
        ]
        return code

    def _generate_models(self) -> str:
        """Generate Python models from schema"""
        if not self.schema.get('components', {}).get('schemas', {}):
            raise ValueError('No schemas found in components')

        # Generate imports
        code = [
            'from typing import Any, Dict, List, Optional',
            'from datetime import datetime',
            'from pydantic import BaseModel, field_validator',
            '',
            ''
        ]

        # Process each schema in dependency order
        schemas = self.schema['components']['schemas']
        
        # Define model order based on dependencies
        model_order = [
            'Bill',
            'Project',
            'LineItem',
            'Approval',
            'Metadata',
            'BillEvent'
        ]
        
        # Generate models in order
        for model_name in model_order:
            if model_name in schemas:
                code.extend(self._generate_model(model_name, schemas[model_name]))
                code.append('')

        return '\n'.join(code)

    def _generate_model(self, name: str, schema: Dict[str, Any]) -> List[str]:
        """Generate Python model code"""
        code = [
            'from typing import Any, Dict, List, Optional',
            'from datetime import datetime',
            'from pydantic import BaseModel, field_validator',
            '',
            ''
        ]

        # Process each schema
        schemas = self.schema['components']['schemas']
        for name, schema in schemas.items():
            # Add class docstring
            description = schema.get('description', f'Represents a {name}')
            code.extend([
                '"""',
                description,
                '"""'
            ])

            # Generate class definition
            code.extend([
                f'class {name}(BaseModel):',
                ''
            ])

            # Process properties
            properties = schema.get('properties', {})
            required = schema.get('required', [])

            for prop_name, prop_schema in properties.items():
                # Add property docstring if description exists
                if 'description' in prop_schema:
                    code.extend([
                        '    """',
                        f'    {prop_schema["description"]}',
                        '    """'
                    ])

                # Determine property type
                if '$ref' in prop_schema:
                    ref_path = prop_schema['$ref'].split('/')
                    ref_name = ref_path[-1]
                    prop_type = ref_name
                elif prop_schema.get('type') == 'array':
                    if '$ref' in prop_schema.get('items', {}):
                        ref_path = prop_schema['items']['$ref'].split('/')
                        ref_name = ref_path[-1]
                        prop_type = f'List[{ref_name}]'
                    else:
                        item_type = prop_schema['items'].get('type', 'Any')
                        prop_type = f'List[{self._map_type(item_type)}]'
                else:
                    prop_type = self._map_type(prop_schema.get('type', 'string'))

                # Add property definition
                if prop_name in required:
                    code.append(f'    {prop_name}: {prop_type}')
                else:
                    default = 'None' if prop_type != 'bool' else 'False'
                    code.append(f'    {prop_name}: Optional[{prop_type}] = {default}')

            # Add extra fields configuration
            code.extend([
                '',
                '    class Config:',
                '        extra = "allow"',
                ''
            ])

            # Add field validators for date fields
            for prop_name, prop_schema in properties.items():
                if prop_schema.get('format') == 'date':
                    validator_name = f'validate_{prop_name}'
                    is_optional = prop_name not in required
                    param_type = f'Optional[str]' if is_optional else 'str'
                    code.extend([
                        '    @field_validator("' + prop_name + '")',
                        '    def ' + validator_name + f'(cls, v: {param_type}) -> {param_type}:',
                        '        """Validate date format"""',
                        '        if v is None:',
                        '            return v',
                        '        try:',
                        '            datetime.strptime(v, "%Y-%m-%d")',
                        '            return v',
                        '        except ValueError:',
                        '            raise ValueError("Invalid date format. Use YYYY-MM-DD")',
                        ''
                    ])

            code.append('')

        return code

    def _map_type(self, type_name: str) -> str:
        """Map OpenAPI types to Python types"""
        type_map = {
            'string': 'str',
            'integer': 'int',
            'number': 'float',
            'boolean': 'bool',
            'array': 'list',
            'object': 'dict'
        }
        return type_map.get(type_name, 'Any')

    def _get_root_model_name(self) -> str:
        """Get the root model name from schema"""
        if not self.schema.get('components', {}).get('schemas', {}):
            raise ValueError("Schema must have at least one model defined")
        
        # The root model is typically the first one defined
        root_model_name = next(iter(self.schema['components']['schemas'].keys()))
        return root_model_name

    def _generate_event_publisher(self) -> str:
        """Generate event publisher code"""
        root_model = self._get_root_model_name()
        
        code = [
            "import json",
            "import boto3",
            "from typing import Dict, Any",
            f"from generated.python.models import {root_model}",
            f"from generated.python.marshaller import {root_model}Marshaller",
            "",
            "",
            "class BillEventPublisher:",
            "    def __init__(self, event_bus_name: str, source: str = 'homebound.bills'):",
            "        \"\"\"",
            "        Initialize the publisher",
            "",
            "        Args:",
            "            event_bus_name: Name of the EventBridge event bus",
            "            source: Source of the event (default: homebound.bills)",
            "        \"\"\"",
            "        self.event_bus_name = event_bus_name",
            "        self.source = source",
            "        self.client = boto3.client('events')",
            f"        self.marshaller = {root_model}Marshaller()",
            "",
            f"    def publish(self, event: {root_model}, event_type: str) -> Dict[str, Any]:",
            "        \"\"\"",
            "        Publish a bill event to EventBridge",
            "",
            "        Args:",
            f"            event: The {root_model} to publish",
            "            event_type: Type of event (e.g., 'BillApproved', 'BillReversed')",
            "",
            "        Returns:",
            "            EventBridge PutEvents response",
            "",
            "        Raises:",
            "            ValueError: If the event is invalid",
            "            Exception: If there is an error publishing the event",
            "        \"\"\"",
            "        try:",
            "            # Marshal the event to JSON",
            "            event_json = self.marshaller.to_dict(event)",
            "",
            "            # Create the EventBridge event",
            "            event_bridge_event = {",
            "                'Source': self.source,",
            "                'DetailType': event_type,",
            "                'Detail': json.dumps(event_json),",
            "                'EventBusName': self.event_bus_name",
            "            }",
            "",
            "            # Publish the event",
            "            response = self.client.put_events(Entries=[event_bridge_event])",
            "",
            "            # Check for errors",
            "            if response['FailedEntryCount'] > 0:",
            "                failed_entry = response['Entries'][0]",
            "                raise Exception(f'Failed to publish event: {failed_entry.get(\"ErrorMessage\", \"Unknown error\")}')",
            "",
            "            return response",
            "",
            "        except Exception as e:",
            "            error_msg = f'Error publishing {event_type} event: {str(e)}'",
            "            print(error_msg)",
            "            raise",
            ""
        ]
        
        return "\n".join(code)

    def _generate_event_consumer(self) -> str:
        """Generate event consumer code"""
        root_model = self._get_root_model_name()
        
        code = [
            "import json",
            "from typing import Dict, Any, Optional",
            f"from generated.python.models import {root_model}",
            f"from generated.python.marshaller import {root_model}Marshaller",
            "",
            "",
            "class BillEventConsumer:",
            "    def __init__(self, source: str = 'homebound.bills'):",
            "        \"\"\"",
            "        Initialize the consumer",
            "",
            "        Args:",
            "            source: Expected source of events (default: homebound.bills)",
            "        \"\"\"",
            f"        self.marshaller = {root_model}Marshaller()",
            "        self.source = source",
            "",
            "    def handle_event(self, event: Dict[str, Any], context: Any) -> Optional[Dict[str, Any]]:",
            "        \"\"\"",
            "        Handle an event from EventBridge",
            "",
            "        Args:",
            "            event: The raw event from EventBridge",
            "            context: The Lambda context",
            "",
            "        Returns:",
            "            Optional response data",
            "",
            "        Raises:",
            "            ValueError: If the event is invalid",
            "        \"\"\"",
            "        try:",
            "            # Extract event details",
            "            detail_type = event.get('detail-type')",
            "            source = event.get('source')",
            "            detail = event.get('detail')",
            "",
            "            if not all([detail_type, source, detail]):",
            "                raise ValueError('Missing required event fields')",
            "",
            "            # Verify source",
            "            if source != self.source:",
            "                print(f'Ignoring event from unknown source: {source}')",
            "                return None",
            "",
            "            # Unmarshal and validate the event",
            "            event_data = self.marshaller.from_dict(detail)",
            "",
            "            # Handle different event types",
            "            if detail_type == 'BillApproved':",
            "                return self._handle_bill_approved(event_data)",
            "            elif detail_type == 'BillReversed':",
            "                return self._handle_bill_reversed(event_data)",
            "            else:",
            "                print(f'Unknown event type: {detail_type}')",
            "                return None",
            "",
            "        except Exception as e:",
            "            error_msg = f'Error handling event: {str(e)}'",
            "            print(error_msg)",
            "            raise",
            "",
            f"    def _handle_bill_approved(self, event: {root_model}) -> Dict[str, Any]:",
            "        \"\"\"",
            "        Handle a bill approved event",
            "",
            "        Args:",
            f"            event: The {root_model} event data",
            "",
            "        Returns:",
            "            Response data",
            "        \"\"\"",
            "        print(f'Processing BillApproved event for bill {event.bill.billId}')",
            "        # TODO: Add your business logic here",
            "",
            "        return {",
            "            'statusCode': 200,",
            "            'body': 'Successfully processed BillApproved event'",
            "        }",
            "",
            f"    def _handle_bill_reversed(self, event: {root_model}) -> Dict[str, Any]:",
            "        \"\"\"",
            "        Handle a bill reversed event",
            "",
            "        Args:",
            f"            event: The {root_model} event data",
            "",
            "        Returns:",
            "            Response data",
            "        \"\"\"",
            "        print(f'Processing BillReversed event for bill {event.bill.billId}')",
            "        # TODO: Add your business logic here",
            "",
            "        return {",
            "            'statusCode': 200,",
            "            'body': 'Successfully processed BillReversed event'",
            "        }",
            "",
            "# Lambda handler",
            "def lambda_handler(event: Dict[str, Any], context: Any) -> Optional[Dict[str, Any]]:",
            "    \"\"\"",
            "    AWS Lambda handler for EventBridge events",
            "",
            "    Args:",
            "        event: The raw event from EventBridge",
            "        context: The Lambda context",
            "",
            "    Returns:",
            "        Optional response data",
            "    \"\"\"",
            "    consumer = BillEventConsumer()",
            "    return consumer.handle_event(event, context)",
            ""
        ]
        
        return "\n".join(code)

    def _generate_marshaller(self) -> str:
        """Generate marshaller code"""
        code = [
            'from typing import Any, Dict, List, Optional',
            'from generated.python.models import *',
            '',
            ''
        ]

        # Process each schema
        schemas = self.schema['components']['schemas']
        for name, schema in schemas.items():
            # Generate marshaller class
            code.extend([
                f'class {name}Marshaller:',
                '    """Marshaller for converting dictionaries to model instances"""',
                '',
                '    @staticmethod',
                f'    def from_dict(data: Dict[str, Any]) -> {name}:',
                f'        """Convert dictionary to {name} instance"""',
                '        if not data:',
                f'            raise ValueError("{name} data is required")',
                f'        return {name}('
            ])

            # Process properties
            properties = schema.get('properties', {})
            last_prop = list(properties.keys())[-1]

            for prop_name, prop_schema in properties.items():
                if '$ref' in prop_schema:
                    ref_path = prop_schema['$ref'].split('/')
                    ref_name = ref_path[-1]
                    if prop_name == 'lineItems':
                        code.append(f'            {prop_name}=[{ref_name}Marshaller.from_dict(item) for item in data.get("{prop_name}", [])]{"," if prop_name != last_prop else ""}')
                    else:
                        code.append(f'            {prop_name}={ref_name}Marshaller.from_dict(data["{prop_name}"]){"," if prop_name != last_prop else ""}')
                elif prop_schema.get('type') == 'array' and '$ref' in prop_schema.get('items', {}):
                    ref_path = prop_schema['items']['$ref'].split('/')
                    ref_name = ref_path[-1]
                    code.append(f'            {prop_name}=[{ref_name}Marshaller.from_dict(item) for item in data.get("{prop_name}", [])]{"," if prop_name != last_prop else ""}')
                else:
                    code.append(f'            {prop_name}=data.get("{prop_name}"){"," if prop_name != last_prop else ""}')

            code.extend([
                '        )',
                '',
                '    @staticmethod',
                f'    def to_dict(obj: {name}) -> Dict[str, Any]:',
                f'        """Convert {name} instance to dictionary"""',
                '        return {'
            ])

            # Generate to_dict method
            for prop_name, prop_schema in properties.items():
                if '$ref' in prop_schema:
                    ref_path = prop_schema['$ref'].split('/')
                    ref_name = ref_path[-1]
                    if prop_name == 'lineItems':
                        code.append(f'            "{prop_name}": [{ref_name}Marshaller.to_dict(x) for x in obj.{prop_name}]{"," if prop_name != last_prop else ""}')
                    else:
                        code.append(f'            "{prop_name}": {ref_name}Marshaller.to_dict(obj.{prop_name}){"," if prop_name != last_prop else ""}')
                elif prop_schema.get('type') == 'array' and '$ref' in prop_schema.get('items', {}):
                    ref_path = prop_schema['items']['$ref'].split('/')
                    ref_name = ref_path[-1]
                    code.append(f'            "{prop_name}": [{ref_name}Marshaller.to_dict(x) for x in obj.{prop_name}]{"," if prop_name != last_prop else ""}')
                else:
                    code.append(f'            "{prop_name}": obj.{prop_name}{"," if prop_name != last_prop else ""}')

            code.extend([
                '        }',
                ''
            ])

        return '\n'.join(code)

    def _generate_publisher(self) -> str:
        """Generate publisher code"""
        code = [
            'import json',
            'import boto3',
            'from typing import Any, Dict',
            'from generated.python.models import BillEvent',
            'from generated.python.marshaller import BillEventMarshaller',
            '',
            'class BillEventPublisher:',
            '    """Publishes bill events to EventBridge"""',
            '',
            '    def __init__(self, event_bus_name: str, event_source: str):',
            '        """Initialize publisher"""',
            '        self.event_bus_name = event_bus_name',
            '        self.event_source = event_source',
            '        self.client = boto3.client("events")',
            '',
            '    def publish(self, event: BillEvent, detail_type: str) -> Dict[str, Any]:',
            '        """',
            '        Publish event to EventBridge',
            '        :param event: Event to publish',
            '        :param detail_type: Type of event (e.g., BillApproved)',
            '        :return: Response from EventBridge',
            '        """',
            '        # Convert event to JSON',
            '        event_json = BillEventMarshaller.to_dict(event)',
            '',
            '        # Publish to EventBridge',
            '        return self.client.put_events(',
            '            Entries=[',
            '                {',
            '                    "Source": self.event_source,',
            '                    "DetailType": detail_type,',
            '                    "Detail": json.dumps(event_json),',
            '                    "EventBusName": self.event_bus_name',
            '                }',
            '            ]',
            '        )',
            ''
        ]
        return '\n'.join(code)

    def _generate_consumer(self) -> str:
        """Generate consumer code"""
        code = [
            'import json',
            'from typing import Dict, Any, Optional',
            'from generated.python.models import BillEvent',
            'from generated.python.marshaller import BillEventMarshaller',
            '',
            'class BillEventConsumer:',
            '    """Consumes bill events from EventBridge"""',
            '',
            '    @staticmethod',
            '    def parse_event(event: Dict[str, Any]) -> Optional[BillEvent]:',
            '        """',
            '        Parse event from EventBridge',
            '        :param event: Event from EventBridge',
            '        :return: BillEvent instance or None if parsing fails',
            '        """',
            '        try:',
            '            detail = json.loads(event.get("detail", "{}")) if isinstance(event.get("detail"), str) else event.get("detail", {})',
            '            return BillEventMarshaller.from_dict(detail)',
            '        except Exception as e:',
            '            print(f"Error parsing event: {str(e)}")',
            '            return None',
            ''
        ]
        return '\n'.join(code)

    def _generate_validator(self) -> str:
        """Generate validator code"""
        code = [
            'from typing import Any, Dict, List, Optional',
            'from datetime import datetime',
            'from generated.python.models import *',
            'from generated.python.marshaller import BillEventMarshaller',
            '',
            'class ValidationError(Exception):',
            '    """Raised when event validation fails"""',
            '    pass',
            '',
            'class Validator:',
            '    """Validates events against schema"""',
            '',
            '    @staticmethod',
            '    def validate_event(event_type: str, event_data: Dict[str, Any]) -> None:',
            '        """',
            '        Validate event data against schema',
            '        :param event_type: Type of event (e.g., BillApproved)',
            '        :param event_data: Event data to validate',
            '        :raises: ValidationError if validation fails',
            '        """',
            '        try:',
            '            # Create and validate event instance',
            '            BillEventMarshaller.from_dict(event_data)',
            '        except Exception as e:',
            '            raise ValidationError(f"Validation error: {str(e)}")',
            ''
        ]
        return '\n'.join(code)

    def generate(self) -> None:
        """Generate all Python code files"""
        if not self.output_dir:
            raise ValueError("Output directory not set")
        
        # Generate models
        models_code = self._generate_models()
        output_path = self.output_dir / 'models.py'
        output_path.write_text(models_code)
        print(f"Generated models.py")
        
        # Generate event bridge publisher
        publisher_code = self._generate_event_publisher()
        output_path = self.output_dir / 'event_bridge_publisher.py'
        output_path.write_text(publisher_code)
        print(f"Generated event_bridge_publisher.py")
        
        # Generate event bridge consumer
        consumer_code = self._generate_event_consumer()
        output_path = self.output_dir / 'event_bridge_consumer.py'
        output_path.write_text(consumer_code)
        print(f"Generated event_bridge_consumer.py")
        
        # Generate marshaller
        marshaller_code = self._generate_marshaller()
        output_path = self.output_dir / 'marshaller.py'
        output_path.write_text(marshaller_code)
        print(f"Generated marshaller.py")
        
        # Generate each component using templates for now
        # TODO: Convert these to inline generation as well
        components = [
            ('validator.py', 'validator.py.template'),
            ('common.py', 'common.py.template')
        ]
        
        context = self._process_schema()
        for output_file, template_file in components:
            template = self.env.get_template(template_file)
            output = template.render(**context)
            output_path = self.output_dir / output_file
            output_path.write_text(output)
            print(f"Generated {output_file}")

def validate_spec(spec: Dict[str, Any]) -> None:
    if 'components' not in spec or 'schemas' not in spec['components']:
        raise ValueError("Schema must contain components.schemas section")

def main():
    parser = argparse.ArgumentParser(description='Generate Python code from OpenAPI schema')
    parser.add_argument('--schema', required=True, type=Path, help='Path to OpenAPI schema file')
    parser.add_argument('--output', required=True, type=Path, help='Output directory')
    parser.add_argument('--event-bridge', type=bool, default=True, help='Generate AWS EventBridge integration code')

    args = parser.parse_args()

    options = CodeGeneratorOptions(
        schema=args.schema,
        output_dir=args.output,
        include_event_bridge=args.event_bridge
    )

    generator = PythonGenerator()
    generator.initialize(options)
    generator.generate()

if __name__ == '__main__':
    main()
