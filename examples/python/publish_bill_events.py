import os
import json
import sys
from datetime import datetime, timezone
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv(os.path.join(os.path.dirname(__file__), '../.env'))

# Add generated code to Python path
generated_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../generated/python'))
if generated_dir not in sys.path:
    sys.path.insert(0, generated_dir)

# Import generated modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
from generated.python.models import BillEvent
from generated.python.marshaller import BillEventMarshaller
from generated.python.event_bridge_publisher import BillEventPublisher


def load_event() -> BillEvent:
    """Load bill event from JSON file"""
    json_path = os.path.join(os.path.dirname(__file__), '../billApprovedEvent.json')
    with open(json_path, 'r') as f:
        event_data = json.load(f)
    
    # Use the marshaller to convert JSON to BillEvent
    return BillEventMarshaller.from_dict(event_data)


def main():
    """Main function"""
    # Check required environment variables
    required_vars = {
        'AWS_REGION': 'AWS region',
        'AWS_PROFILE': 'AWS profile name',
        'EVENT_BUS_NAME': 'EventBridge event bus name',
        'EVENT_SOURCE': 'Event source'
    }
    
    missing_vars = [var for var, desc in required_vars.items() if not os.getenv(var)]
    if missing_vars:
        raise ValueError(f'Missing required environment variables: {", ".join(missing_vars)}')

    # Create publisher
    publisher = BillEventPublisher(os.getenv('EVENT_BUS_NAME'), os.getenv('EVENT_SOURCE'))

    # Load event from JSON file
    event = load_event()

    try:
        # Publish event
        response = publisher.publish(event, 'BillApproved')
        print(f'Successfully published event: {response}')
    except Exception as e:
        print(f'Error publishing event: {str(e)}')
        raise


if __name__ == '__main__':
    main()
